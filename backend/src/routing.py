"""FastAPI route glue: stable, human-readable OpenAPI operation IDs.

Operation IDs are derived from endpoint function names (snake_case -> camelCase)
so the generated frontend client (frontend/src/api/client) gets stable
function/type names across regenerations.
"""

from fastapi.routing import APIRoute


def snake_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def generate_unique_id(route: APIRoute) -> str:
    """OpenAPI operation ID from the endpoint function name."""
    return snake_to_camel(route.endpoint.__name__)


class FunctionNameOperationIdRoute(APIRoute):
    """APIRoute that defaults ``operation_id`` to the camelCased endpoint name.

    Use as ``APIRouter(route_class=FunctionNameOperationIdRoute)``.
    """

    def __init__(self, *args, **kwargs):
        if "operation_id" not in kwargs:
            endpoint = kwargs.get("endpoint")
            if endpoint:
                kwargs["operation_id"] = snake_to_camel(endpoint.__name__)
        super().__init__(*args, **kwargs)
