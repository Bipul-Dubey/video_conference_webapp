from typing import Optional, List, Dict, Any, Union
from pydantic import BaseModel

class ResponseModel(BaseModel):
    status_code: int
    message: str
    data: Optional[Union[Dict[str, Any], List[Dict[str, Any]]]] = None
    error: bool