class StacnotatorError(Exception):
    """Base for all SDK errors."""


class NotLoggedInError(StacnotatorError):
    def __init__(self) -> None:
        super().__init__("Not logged in. Run `stacnotator.login(url)` first.")


class AuthenticationError(StacnotatorError):
    pass


class ApiError(StacnotatorError):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
        super().__init__(f"API error {status}: {detail}")
