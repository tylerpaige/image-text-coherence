"""Load the repo-root .env. Scripts are run from pipeline/, and python-dotenv
defaults to the current directory, so an unqualified load_dotenv() would
miss it."""

from pathlib import Path

from dotenv import load_dotenv

ROOT_ENV = Path(__file__).resolve().parents[1] / ".env"


def load_root_env() -> None:
    load_dotenv(ROOT_ENV)
