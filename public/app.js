const statusEl = document.querySelector('#status');
const listEl = document.querySelector('#projects');
const countEl = document.querySelector('#project-count');

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
    listEl.innerHTML = '<div class="empty">HD is not connected to its database yet. The dashboard is ready for deployment.</div>';
    statusEl.textContent = 'Build mode';
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

document.querySelector('#refresh').addEventListener('click', loadProjects);
loadProjects();
