const statusEl = document.querySelector('#status');
const listEl = document.querySelector('#projects');
const countEl = document.querySelector('#project-count');
const filesEl = document.querySelector('#files');
const uploadForm = document.querySelector('#upload-form');
const uploadButton = document.querySelector('#upload-button');
const uploadStatus = document.querySelector('#upload-status');
const dropzone = document.querySelector('.dropzone');
const fileInput = document.querySelector('#file-input');

async function loadProjects() {
  listEl.innerHTML = '<div class="empty">Loading projects…</div>';
  try {
    const response = await fetch('/api/projects');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const projects = data.projects || [];
    countEl.textContent = projects.length;
    listEl.innerHTML = projects.length
      ? projects.map(project => `
          <div class="project">
            <div><strong>${escapeHtml(project.name)}</strong><br><small>${escapeHtml(project.description || 'No description')}</small></div>
            <small>${escapeHtml(project.status)}</small>
          </div>`).join('')
      : '<div class="empty">No projects yet.</div>';
    statusEl.textContent = 'Connected';
  } catch (error) {
    countEl.textContent = '—';
    listEl.innerHTML = '<div class="empty">HD is not connected to its database yet.</div>';
    statusEl.textContent = 'Build mode';
  }
}

async function loadFiles() {
  filesEl.innerHTML = '<div class="empty">Loading files…</div>';
  try {
    const response = await fetch('/api/files?project_id=project-hd');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const files = data.files || [];
    filesEl.innerHTML = files.length
      ? files.map(file => `
        <div class="project">
          <div><strong>${escapeHtml(file.filename)}</strong><br><small>${formatBytes(file.size_bytes)}</small></div>
          <a class="download" href="/api/files/${encodeURIComponent(file.file_id)}">Download</a>
        </div>`).join('')
      : '<div class="empty">No files uploaded yet.</div>';
  } catch {
    filesEl.innerHTML = '<div class="empty">Files will appear here after storage is connected.</div>';
  }
}

function setSelectedFile(file) {
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;
  uploadStatus.textContent = 'Ready: ' + file.name;
}

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragover');
  setSelectedFile(event.dataTransfer.files[0]);
});

fileInput.addEventListener('change', () => {
  setSelectedFile(fileInput.files[0]);
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!fileInput.files.length) return;
  uploadButton.disabled = true;
  uploadStatus.textContent = 'Uploading…';
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  try {
    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Upload failed.');
    uploadStatus.textContent = 'Upload complete.';
    fileInput.value = '';
    await loadFiles();
  } catch (error) {
    uploadStatus.textContent = error.message;
  } finally {
    uploadButton.disabled = false;
  }
});

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

document.querySelector('#refresh').addEventListener('click', () => {
  loadProjects();
  loadFiles();
});
loadProjects();
loadFiles();
