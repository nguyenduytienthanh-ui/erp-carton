class VisionQueueAdapter:
    """No-op queue boundary for the future vision worker."""

    backend_name = 'none'

    def enqueue(self, job):
        return {
            'backend': self.backend_name,
            'queued': False,
            'job_id': str(job.job_id),
        }


def get_vision_queue_adapter():
    return VisionQueueAdapter()


def enqueue_vision_job(job):
    return get_vision_queue_adapter().enqueue(job)


def process_vision_job(job_id):
    raise NotImplementedError('Vision worker processing is intentionally not implemented in package 1A.')
