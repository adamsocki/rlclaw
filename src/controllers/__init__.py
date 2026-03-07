# Re-export BaseController from the commaai challenge
import sys
from pathlib import Path

# Add vendor/commaai to path so controllers can import from it
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "vendor" / "commaai"))

from controllers import BaseController

__all__ = ["BaseController"]
