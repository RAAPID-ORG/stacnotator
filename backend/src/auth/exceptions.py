class ExternalAuthEmailNotVerified(Exception):
    def __init__(
        self, message: str = "Email adress is not verified with external authentication provider!"
    ):
        super().__init__(message)
