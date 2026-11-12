"""Custom index formulas typed by campaign admins, compiled into a SpectralIndex.

An expression is parsed with Python's ``ast`` but never run as Python: only the
nodes below are accepted, and our own evaluator walks the tree. The result is the
same kind of callable as a built-in formula, so it runs on floats, on Earth Engine
images in fetch.py, and renders for the UI.

The language is per-pixel arithmetic over one image's bands, so a custom index
costs Earth Engine what a built-in one does.
"""

import ast
import math
import operator
import re
from collections.abc import Callable
from typing import Any, TypeGuard, get_args

from src.timeseries.indices import (
    INDICES,
    BandRole,
    Bands,
    Formula,
    SpectralIndex,
    index_for,
)

MAX_EXPRESSION_LENGTH = 300
MAX_EXPRESSION_NODES = 64

BAND_ROLES: tuple[str, ...] = get_args(BandRole)

_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,23}")
_BUILT_IN_KEYS = frozenset(index.key.casefold() for index in INDICES)

# name -> (arity, the plain-float implementation).
FUNCTIONS: dict[str, tuple[int, Callable[..., float]]] = {
    "sqrt": (1, math.sqrt),
    "abs": (1, abs),
    "log": (1, math.log),
    "exp": (1, math.exp),
    "min": (2, min),
    "max": (2, max),
}

_BINARY: dict[type[ast.operator], Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
}


class ExpressionError(ValueError):
    """The expression is not one we accept; the message is shown to the admin."""


def _is_role(name: str) -> TypeGuard[BandRole]:
    return name in BAND_ROLES


def _check(node: ast.expr, roles: list[BandRole]) -> None:
    """Accept only the grammar above, collecting the band roles read in order."""
    match node:
        case ast.Constant(value=int() | float() as value) if not isinstance(value, bool):
            pass
        case ast.Name(id=name):
            if not _is_role(name):
                raise ExpressionError(f"Unknown band '{name}'. Bands are: {', '.join(BAND_ROLES)}")
            if name not in roles:
                roles.append(name)
        case ast.BinOp(left=left, op=op, right=right) if type(op) in _BINARY:
            _check(left, roles)
            _check(right, roles)
        case ast.UnaryOp(op=ast.USub() | ast.UAdd(), operand=operand):
            _check(operand, roles)
        case ast.Call(func=ast.Name(id=name), args=args, keywords=[]) if name in FUNCTIONS:
            arity = FUNCTIONS[name][0]
            if len(args) != arity or any(isinstance(arg, ast.Starred) for arg in args):
                raise ExpressionError(f"{name} takes {arity} argument{'s' if arity > 1 else ''}")
            for arg in args:
                _check(arg, roles)
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
        case ast.Call(func=ast.Name(id=name), args=args):
            values = [_evaluate(arg, bands) for arg in args]
            # A band value (an Earth Engine image, a rendered term) applies the
            # function itself; plain constants use the float implementation.
            term = next((v for v in values if hasattr(v, "apply")), None)
            return term.apply(name, values) if term is not None else FUNCTIONS[name][1](*values)
    raise AssertionError(f"unchecked node {ast.dump(node)}")


def _check_constants(body: ast.expr) -> None:
    """Parts without a band are computed in plain Python wherever the formula runs,
    so one that fails or leaves the real numbers, like 1 / 0 or sqrt(-1), is
    refused here rather than on every read."""
    for node in ast.walk(body):
        if (
            not isinstance(node, ast.expr)
            or isinstance(node, ast.Name)
            or any(isinstance(n, ast.Name) and _is_role(n.id) for n in ast.walk(node))
        ):
            continue
        try:
            value = _evaluate(node, {})
        except (ArithmeticError, ValueError) as exc:
            raise ExpressionError(f"'{ast.unparse(node)}' cannot be computed") from exc
        if not isinstance(value, float) or not math.isfinite(value):
            raise ExpressionError(f"'{ast.unparse(node)}' is not a finite number")


def compile_expression(expression: str) -> tuple[tuple[BandRole, ...], Formula]:
    """The band roles an expression reads and the formula it computes."""
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
    _check_constants(body)
    return tuple(roles), lambda bands: _evaluate(body, bands)


def custom_index(name: str, expression: str, domain_min: float, domain_max: float) -> SpectralIndex:
    """A custom index, or ExpressionError saying what the admin needs to change."""
    if not _NAME.fullmatch(name):
        raise ExpressionError("Name it with up to 24 letters, digits or _, starting with a letter")
    if name.casefold() in _BUILT_IN_KEYS:
        raise ExpressionError(f"{name} is a built-in index")
    if not domain_min < domain_max:
        raise ExpressionError("The chart minimum must be below its maximum")
    roles, formula = compile_expression(expression)
    return SpectralIndex(
        key=name,
        label=name,
        roles=roles,
        formula=formula,
        domain=(domain_min, domain_max),
        reference_lines=(),
    )


def series_index(
    ts_type: str, expression: str | None, domain_min: float | None, domain_max: float | None
) -> SpectralIndex | None:
    """The index a series plots: the custom formula it carries, named by ts_type,
    or else the built-in index ts_type names."""
    if expression is None or domain_min is None or domain_max is None:
        return index_for(ts_type)
    return custom_index(ts_type, expression, domain_min, domain_max)
