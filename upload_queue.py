import enum
import io
import logging
import queue
import threading
import time
import uuid
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


class JobStatus(enum.Enum):
    pending = "pending"
    compressing = "compressing"
    uploading = "uploading"
    done = "done"
    error = "error"
    cancelled = "cancelled"


@dataclass
class UploadJob:
    id: str
    filename: str
    album_id: str | None
    crf: int
    compress: bool
    status: JobStatus = JobStatus.pending
    progress: float = 0.0
    original_size: int = 0
    compressed_size: int | None = None
    asset_id: str | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    # File data attached at runtime (not serialized)
    data_stream: io.BytesIO | None = field(default=None, init=False, repr=False)


class UploadQueue:
    def __init__(self):
        self._jobs: dict[str, UploadJob] = {}
        self._queue: queue.Queue[UploadJob] = queue.Queue()
        self._lock = threading.Lock()
        self._worker_thread: threading.Thread | None = None
        self._running = False

    def start(self):
        if self._running:
            return
        self._running = True
        self._worker_thread = threading.Thread(
            target=self._worker, daemon=True, name="upload-worker"
        )
        self._worker_thread.start()
        logger.info("Upload queue worker started")

    def add_job(self, filename, album_id=None, crf=28, compress=False, data_stream=None):
        job_id = uuid.uuid4().hex[:12]
        job = UploadJob(
            id=job_id,
            filename=filename,
            album_id=album_id,
            crf=crf,
            compress=compress,
        )
        job.data_stream = data_stream  # Set BEFORE putting in queue
        with self._lock:
            self._jobs[job_id] = job
        self._queue.put(job)
        logger.info("Upload job added: %s (%s)", job_id, filename)
        return job

    def get_jobs(self):
        with self._lock:
            return list(self._jobs.values())

    def get_job(self, job_id):
        with self._lock:
            return self._jobs.get(job_id)

    def cancel_job(self, job_id):
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            if job.status in (JobStatus.done, JobStatus.error, JobStatus.cancelled):
                return job
            job.status = JobStatus.cancelled
        logger.info("Upload job cancelled: %s", job_id)
        return job

    def _process_job(self, job):
        from immich import do_upload, do_upload_compressed

        job.status = JobStatus.uploading if not job.compress else JobStatus.compressing
        try:
            if job.compress:
                do_upload_compressed(job)
            else:
                do_upload(job)
            job.status = JobStatus.done
            logger.info("Upload job completed: %s (%s)", job.id, job.filename)
        except Exception as e:
            job.status = JobStatus.error
            job.error = str(e)
            logger.error("Upload job failed: %s — %s", job.id, e)

    def _worker(self):
        logger.info("Upload worker loop started")
        while self._running:
            try:
                job = self._queue.get(timeout=1)
            except queue.Empty:
                continue

            if job.status == JobStatus.cancelled:
                continue

            self._process_job(job)
        logger.info("Upload worker loop stopped")


upload_queue = UploadQueue()
