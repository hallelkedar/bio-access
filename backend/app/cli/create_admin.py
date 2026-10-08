"""Create an ADMIN user.

Usage (from backend/):
    .venv/bin/python -m app.cli.create_admin --email admin@example.com --name "Admin"
"""

import argparse
import sys
from getpass import getpass

from pydantic import ValidationError

from app.db.session import SessionLocal
from app.schemas.user import UserCreate
from app.services import auth as auth_service


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create an ADMIN user.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True, help="full name")
    parser.add_argument("--phone", default=None)
    args = parser.parse_args(argv)

    password = getpass("Password: ")
    if getpass("Repeat password: ") != password:
        print("Error: passwords do not match.", file=sys.stderr)
        return 1

    try:
        data = UserCreate(
            email=args.email, full_name=args.name, phone=args.phone, password=password
        )
    except ValidationError as exc:
        for error in exc.errors():
            field = ".".join(str(part) for part in error["loc"])
            print(f"Error: {field}: {error['msg']}", file=sys.stderr)
        return 1

    with SessionLocal() as db:
        try:
            user = auth_service.create_admin(db, data)
        except auth_service.EmailAlreadyRegisteredError:
            print(f"Error: {data.email} is already registered.", file=sys.stderr)
            return 1

    print(f"Admin created: id={user.id} email={user.email}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
