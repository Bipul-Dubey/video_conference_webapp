from fastapi import FastAPI
import os
from dotenv import load_dotenv
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi.middleware.cors import CORSMiddleware
from fastapi_socketio import SocketManager
import subprocess

# Load environment variables
load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting app.......")
    
    # Create a connection to ensure DB is accessible
    # async with engine.begin() as conn:
    #     await conn.run_sync(lambda _: print("Database Connected!"))  

    yield  # Application starts here

    print("Closing connection...")
    # await engine.dispose()

# Create FastAPI app with lifespan
app = FastAPI(lifespan=lifespan)


# ✅ Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change this to specific origins if needed
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sio = SocketManager(
    app=app,
    cors_allowed_origins="*",
    async_mode='asgi',
    mount_location="/socket.io/"
)

# import after socket connection
import conference.conference_socket


# routes import
# from conferences.routes import router as conferences_routes
# Common API prefix "/api"
# app.include_router(conferences_routes, prefix="/api/v1")

@app.get("/")
def health_check():
    return {"message": "API is running!"}

# ====== Main Entry Point =======
PORT = int(os.getenv("PORT", 8000))

def run_server():
    """Run the FastAPI app using uvicorn."""
    url = f"http://127.0.0.1:{PORT}"
    print(f"🚀 FastAPI server is running at: {url}")
    print(f"📜 API Docs available at: {url}/docs")
    # print(f"📜 OpenAPI JSON available at: {url}/openapi.json")
    
    subprocess.run(["uvicorn", "main:app", "--reload", "--port", str(PORT)])

if __name__ == "__main__":
    run_server()
