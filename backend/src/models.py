"""Global collection of all models to ensure discovery for Alembic"""

from src.auth.models import *  # noqa
from src.campaigns.models import *  # noqa
from src.canvas.models import *  # noqa
from src.annotation.models import *  # noqa
from src.imagery.models import *  # noqa
import src.organizations.models  # noqa: F401
import src.projects.models  # noqa: F401
from src.timeseries.models import *  # noqa
from src.custom_layers.models import *  # noqa
from src.visualizers.models import *  # noqa
