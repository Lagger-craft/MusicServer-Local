FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; exit(0 if urllib.request.urlopen('http://localhost:5000/api/health').status == 200 else 1)"

CMD ["gunicorn", "-w", "4", "--timeout", "300", "-b", "0.0.0.0:5000", "wsgi:app"]
