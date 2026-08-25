from fastapi import Depends, Path
from sqlalchemy.orm import Session

from src.auth.dependencies import require_authenticated_user
from src.auth.models import User
from src.database import get_db
from src.projects.dependencies import require_project_admin
from src.visualizers import service
from src.visualizers.models import Visualizer


def require_visualizer_admin(
    visualizer_id: int = Path(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> Visualizer:
    """A visualizer is administered by the admins of the project that owns it."""
    visualizer = service.load(db, visualizer_id=visualizer_id)
    require_project_admin(project_id=visualizer.project_id, db=db, user=user)
    return visualizer
