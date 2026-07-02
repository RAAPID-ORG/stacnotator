import argparse
import sys

from stacnotator import client
from stacnotator.errors import StacnotatorError


def _login(args: argparse.Namespace) -> None:
    user = client.login(args.url)
    print(f"Logged in to {args.url} as {user.get('email')}")


def _logout(args: argparse.Namespace) -> None:
    client.logout()
    print("Logged out.")


def _whoami(args: argparse.Namespace) -> None:
    user = client.whoami()
    display_name = user.get("display_name")
    suffix = f" ({display_name})" if display_name else ""
    print(f"{user.get('email')}{suffix}")


def _campaigns(args: argparse.Namespace) -> None:
    print(client.campaigns().to_string(index=False))


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="stacnotator", description="STACNotator SDK CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    login = subparsers.add_parser("login", help="Log in via the browser and cache credentials")
    login.add_argument("url", help="STACNotator base URL, e.g. https://app.example.org")
    login.set_defaults(handler=_login)

    logout = subparsers.add_parser("logout", help="Delete cached credentials")
    logout.set_defaults(handler=_logout)

    whoami = subparsers.add_parser("whoami", help="Show the logged-in user")
    whoami.set_defaults(handler=_whoami)

    campaigns = subparsers.add_parser("campaigns", help="List accessible campaigns")
    campaigns.set_defaults(handler=_campaigns)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        args.handler(args)
    except StacnotatorError as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
