"""Custom index formulas typed by campaign admins, compiled into a SpectralIndex.

An expression is parsed with Python's ``ast`` but never run as Python: only the
nodes below are accepted, and our own evaluator walks the tree. The result is the
same kind of callable as a built-in formula, so it runs on floats in the tests, on
Earth Engine images in fetch.py, and renders for the UI, without any of those
knowing it was typed by a user.

The language is per-pixel by design: arithmetic, comparisons and a few pointwise
functions over one image's bands. Nothing in it can reach neighbourhoods, temporal
reductions or other collections, so a custom index costs Earth Engine what a
built-in one does - the request size is bounded by the source and the date range,
not by the formula.
"""

import ast
import math
import operator
from collections.abc import Callable
from typing import Any, Protocol, TypeGuard, get_args

from src.timeseries.indices import BandRole, Bands, Formula, SpectralIndex

MAX_EXPRESSION_LENGTH = 300
MAX_EXPRESSION_NODES = 64

BAND_ROLES: tuple[str, ...] = get_args(BandRole)

# name -> (arity, the plain-float implementation the tests and dry runs use).
FUNCTIONS: dict[str, tuple[int, Callable[..., float]]] = {
    "sqrt": (1, math.sqrt),
    "abs": (1, abs),
    "log": (1, math.log),
    "exp": (1, math.exp),
    "min": (2, min),
    "max": (2, max),
    "clamp": (3, lambda x, low, high: min(max(x, low), high)),
    "where": (3, lambda condition, then, otherwise: then if condition else otherwise),
}

_BINARY: dict[type[ast.operator], Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
}

_COMPARE: dict[type[ast.cmpop], Callable[[Any, Any], Any]] = {
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
}


def _is_role(name: str) -> TypeGuard[BandRole]:
    return name in BAND_ROLES


class ExpressionError(ValueError):
    """The expression is not one we accept; the message is shown to the admin."""


class FunctionTerm(Protocol):
    """A band value that knows how to apply the named functions to itself."""

    @classmethod
    def apply(cls, name: str, args: list[Any]) -> Any: ...


def call_function(name: str, args: list[Any]) -> Any:
    term = next((arg for arg in args if hasattr(type(arg), "apply")), None)
    if term is None:
        return FUNCTIONS[name][1](*args)
    function_term: type[FunctionTerm] = type(term)
    return function_term.apply(name, args)


def _check(node: ast.expr, roles: list[BandRole]) -> None:
    """Accept only the grammar above, collecting the band roles read in order."""
    match node:
        case ast.Constant(value=value) if isinstance(value, int | float) and not isinstance(
            value, bool
        ):
            try:
                finite = math.isfinite(float(value))
            except OverflowError:
                finite = False
            if not finite:
                raise ExpressionError(f"{value} is too large")
        case ast.Name(id=name):
            if name in FUNCTIONS:
                raise ExpressionError(f"{name} is a function, call it like {name}(...)")
            if not _is_role(name):
                raise ExpressionError(f"Unknown band '{name}'. Bands are: {', '.join(BAND_ROLES)}")
            if name not in roles:
                roles.append(name)
        case ast.BinOp(left=left, op=op, right=right) if type(op) in _BINARY:
            _check(left, roles)
            _check(right, roles)
        case ast.UnaryOp(op=ast.USub() | ast.UAdd(), operand=operand):
            _check(operand, roles)
        case ast.Compare(left=left, ops=[op], comparators=[right]) if type(op) in _COMPARE:
            _check(left, roles)
            _check(right, roles)
        case ast.Compare():
            raise ExpressionError("Only single comparisons with < <= > >= are supported")
        case ast.Call(func=ast.Name(id=name), args=args, keywords=[]) if name in FUNCTIONS:
            arity = FUNCTIONS[name][0]
            if len(args) != arity or any(isinstance(arg, ast.Starred) for arg in args):
                raise ExpressionError(f"{name} takes {arity} argument{'s' if arity > 1 else ''}")
            for arg in args:
                _check(arg, roles)
        case ast.Call(func=ast.Name(id=name)):
            raise ExpressionError(
                f"Unknown function '{name}'. Functions are: {', '.join(FUNCTIONS)}"
            )
        case _:
            raise ExpressionError(f"'{ast.unparse(node)}' is not supported")


def _evaluate(node: ast.expr, bands: Bands) -> Any:
    match node:
        case ast.Constant(value=int() | float() as value):
            return float(value)
        case ast.Name(id=name) if _is_role(name):
            return bands[name]
        case ast.BinOp(left=left, op=op, right=right):
            return _BINARY[type(op)](_evaluate(left, bands), _evaluate(right, bands))
        case ast.UnaryOp(op=ast.USub(), operand=operand):
            return -_evaluate(operand, bands)
        case ast.UnaryOp(operand=operand):
            return _evaluate(operand, bands)
        case ast.Compare(left=left, ops=[op], comparators=[right]):
            result = _COMPARE[type(op)](_evaluate(left, bands), _evaluate(right, bands))
            # Two constants compare to a bool; keep it a number like every other value.
            return float(result) if isinstance(result, bool) else result
        case ast.Call(func=ast.Name(id=name), args=args):
            return call_function(name, [_evaluate(arg, bands) for arg in args])
    raise AssertionError(f"unchecked node {ast.dump(node)}")


def compile_expression(expression: str) -> tuple[tuple[BandRole, ...], Formula]:
    """The band roles an expression reads and the formula it computes. Raises
    ExpressionError for anything outside the grammar."""
    if len(expression) > MAX_EXPRESSION_LENGTH:
        raise ExpressionError(f"Keep the expression under {MAX_EXPRESSION_LENGTH} characters")
    try:
        body = ast.parse(expression.strip(), mode="eval").body
    except SyntaxError as exc:
        raise ExpressionError(f"Not a valid expression: {exc.msg}") from exc

    if sum(isinstance(node, ast.expr) for node in ast.walk(body)) > MAX_EXPRESSION_NODES:
        raise ExpressionError(f"Keep the expression under {MAX_EXPRESSION_NODES} terms")
    roles: list[BandRole] = []
    _check(body, roles)
    if not roles:
        raise ExpressionError("The expression must read at least one band")
    return tuple(roles), lambda bands: _evaluate(body, bands)


def custom_index(
    name: str,
    expression: str,
    domain: tuple[float, float],
    reference_lines: tuple[float, ...],
) -> SpectralIndex:
    roles, formula = compile_expression(expression)
    return SpectralIndex(
        key=name,
        label=name,
        roles=roles,
        formula=formula,
        domain=domain,
        reference_lines=reference_lines,
    )
