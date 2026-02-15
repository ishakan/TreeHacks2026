from __future__ import annotations

from pydantic import BaseModel


class GenerateRequest(BaseModel):
    description: str
    image: str | None = None  # base64-encoded image


class RefineRequest(BaseModel):
    sessionId: str
    feedback: str


class PlanStep(BaseModel):
    description: str
    operations: list[str] = []


class PlanResult(BaseModel):
    approach: str
    steps: list[PlanStep] = []
    selectedMethods: list[str] = []
    complexity: str = "moderate"
    notes: str = ""


class ParameterEntry(BaseModel):
    value: int | float | str
    type: str
    description: str


class ParameterUpdateRequest(BaseModel):
    parameters: dict[str, float | str]


class ParameterResponse(BaseModel):
    parameters: dict[str, ParameterEntry]
    scadCode: str


# ---------------------------------------------------------------------------
# Blueprint workflow models
# ---------------------------------------------------------------------------

class BlueprintRequest(BaseModel):
    description: str


class BlueprintRefineRequest(BaseModel):
    sessionId: str
    feedback: str


class BlueprintConfirmRequest(BaseModel):
    sessionId: str


class BlueprintDimension(BaseModel):
    value: float | int
    unit: str = "mm"
    description: str


class BlueprintDimensionUpdateRequest(BaseModel):
    dimensions: dict[str, float | int]
