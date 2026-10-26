/**
 * app.js —— 页面交互与流程状态
 * 原则：输入变化必须作废旧结果；异常必须可见；任何外部文本均用安全 DOM API 渲染。
 */
(function () {
  'use strict';

  const state = {
    groups: new Map(),
    built: null,
    notices: [],
    busy: false,
  };
  const $ = id => document.getElementById(id);
  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const status = (text, color) => {
    $('status').textContent = text;
    $('status').style.color = color || 'var(--color-sub)';
  };
  const waitForPaint = () => new Promise(resolve => setTimeout(resolve, 20));

  function guessWeek(name) {
    const m = String(name).match(/第\s*(\d+)\s*周/);
    return m ? `第${parseInt(m[1], 10)}周` : '';
  }

  function normalizeWeek(value) {
    const text = String(value || '').trim();
    const m = text.match(/^(?:第\s*)?0*(\d+)\s*周?$/);
    return m ? `第${parseInt(m[1], 10)}周` : text;
  }

  function weekNumber(week) {
    const m = String(week).match(/\d+/);
    return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
  }

  function sortGroups() {
    state.groups = new Map([...state.groups.entries()].sort((a, b) =>
      weekNumber(a[0]) - weekNumber(b[0]) || a[0].localeCompare(b[0], 'zh-CN')));
  }

  function updateSteps() {
    const hasFiles = state.groups.size > 0;
    const ready = hasFiles && [...state.groups.keys()].every(Boolean);
    const ids = ['step1', 'step2', 'step3', 'step4'];
    ids.forEach(id => { $(id).className = ''; });
    if (!hasFiles) $('step1').className = 'active';
    else if (!ready) { $('step1').className = 'done'; $('step2').className = 'active'; }
    else if (!state.built) { $('step1').className = 'done'; $('step2').className = 'done'; $('step3').className = 'active'; }
    else { $('step1').className = 'done'; $('step2').className = 'done'; $('step3').className = 'done'; $('step4').className = 'active'; }
  }

  function setProgress(percent, visible) {
    $('progress').classList.toggle('hide', !visible);
    $('progressFill').style.width = `${percent}%`;
  }

  function updateRunState() {
    const ready = state.groups.size > 0 && [...state.groups.keys()].every(Boolean);
    $('run').disabled = state.busy || !ready;
    updateSteps();
  }

  function invalidateResult() {
    if (!state.built && $('checkCard').classList.contains('hide')) return;
    state.built = null;
    ['checkCard', 'previewCard', 'downCard'].forEach(id => $(id).classList.add('hide'));
    $('downInfo').textContent = '';
    $('ackSevere').checked = false;
    setProgress(0, false);
    status('内容已更改，请重新生成汇总表', 'var(--color-warn)');
    updateSteps();
  }

  function renderNotices() {
    const box = $('files');
    box.replaceChildren();
    for (const text of state.notices.slice(-12)) box.appendChild(make('div', 'notice', text));
  }

  function addNotice(text) {
    if (!state.notices.includes(text)) state.notices.push(text);
    renderNotices();
  }

  function removeFile(week, index) {
    invalidateResult();
    const files = state.groups.get(week);
    if (!files) return;
    const removed = files.splice(index, 1)[0];
    if (!files.length) state.groups.delete(week);
    addNotice(`已移除 ${removed.name}，未改动原始文件`);
    renderWeeks();
    status('文件清单已更新，请重新生成', 'var(--color-warn)');
  }

  function removeWeek(week) {
    invalidateResult();
    state.groups.delete(week);
    addNotice(`已移除「${week || '待定周次'}」的导入记录，未改动原始文件`);
    renderWeeks();
    status('文件清单已更新', 'var(--color-warn)');
  }

  function changeWeek(oldWeek, value) {
    const nextWeek = normalizeWeek(value);
    if (nextWeek === oldWeek) { renderWeeks(); return; }
    invalidateResult();
    const moving = state.groups.get(oldWeek) || [];
    state.groups.delete(oldWeek);
    if (nextWeek && state.groups.has(nextWeek)) {
      state.groups.set(nextWeek, state.groups.get(nextWeek).concat(moving));
      addNotice(`「${oldWeek || '待定'}」已并入「${nextWeek}」，两组文件均已保留`);
    } else {
      state.groups.set(nextWeek, moving);
    }
    sortGroups();
    renderWeeks();
    status(nextWeek ? '周次已更新，请核对后重新生成' : '请填写周次后再生成', 'var(--color-warn)');
  }

  function renderWeeks() {
    const box = $('weeks');
    box.replaceChildren();
    for (const [week, files] of state.groups) {
      const card = make('div', 'wk');
      const head = make('div', 'wk-head');
      head.appendChild(make('div', 'wk-title', week ? `已识别：${week}` : '需要确认周次'));
      const remove = make('button', 'wk-remove', '移除本周');
      remove.type = 'button';
      remove.setAttribute('aria-label', `移除${week || '待定周次'}全部导入记录`);
      remove.onclick = () => removeWeek(week);
      head.appendChild(remove);
      card.appendChild(head);

      const label = make('label', 'week-label', '周次');
      const input = document.createElement('input');
      input.value = week;
      input.placeholder = '如 第7周';
      input.setAttribute('aria-label', `${week || '待定'}周次，修改后失焦生效`);
      input.addEventListener('change', event => changeWeek(week, event.target.value));
      label.appendChild(input);
      label.appendChild(make('span', '', `${files.length} 个文件`));
      card.appendChild(label);

      const list = make('ul', 'wk-files');
      files.forEach((file, index) => {
        const item = document.createElement('li');
        item.appendChild(make('span', 'file-name', file.name));
        const del = make('button', 'file-remove', '移除');
        del.type = 'button';
        del.setAttribute('aria-label', `移除文件 ${file.name}`);
        del.onclick = () => removeFile(week, index);
        item.appendChild(del);
        list.appendChild(item);
      });
      card.appendChild(list);
      box.appendChild(card);
    }
    updateRunState();
    if (state.groups.size && ![...state.groups.keys()].every(Boolean)) {
      status('请填写周次（例如 第7周）', 'var(--color-warn)');
    }
  }

  function pushFile(week, file) {
    const key = normalizeWeek(week);
    if (!state.groups.has(key)) state.groups.set(key, []);
    state.groups.get(key).push(file);
  }

  async function collect(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) {
      status('没有接收到文件，请重新拖入或点击选择', 'var(--color-bad)');
      return;
    }
    invalidateResult();
    let added = 0;
    for (const file of files) {
      if (/\.zip$/i.test(file.name)) {
        const week = guessWeek(file.name);
        status(`正在解压「${file.name}」…`);
        try {
          const zip = await JSZip.loadAsync(await file.arrayBuffer());
          const all = Object.values(zip.files).filter(entry => !entry.dir);
          const entries = all.filter(entry => /\.xlsx?$/i.test(entry.name));
          if (!entries.length) {
            addNotice(`「${file.name}」中没有可用的 XLS/XLSX 评分表`);
            continue;
          }
          const unpacked = await Promise.all(entries.map(async entry => ({
            name: entry.name.split('/').pop(),
            buffer: await entry.async('arraybuffer'),
          })));
          for (const item of unpacked) { pushFile(week, item); added++; }
          renderWeeks();
        } catch (error) {
          addNotice(`「${file.name}」解压失败：${error.message}`);
        }
      } else if (/\.xlsx?$/i.test(file.name)) {
        pushFile(guessWeek(file.name), { name: file.name, buffer: await file.arrayBuffer() });
        added++;
      } else {
        addNotice(`已忽略「${file.name}」：请选择 ZIP 或学校原始 XLS/XLSX 评分表`);
      }
    }
    sortGroups();
    renderWeeks();
    if (added) status(`已读入 ${added} 个原始评分表，请核对周次与文件清单`, 'var(--color-ok)');
    else if (!state.groups.size) status('没有识别到可用的评分表', 'var(--color-bad)');
    updateRunState();
  }

  function renderIssues(issues) {
    const level = $('issueLevel').value;
    const week = $('issueWeek').value;
    const filtered = issues.filter(issue => (!level || issue.level === level) && (!week || issue.week === week));
    const list = $('issues');
    list.replaceChildren();
    if (!filtered.length) {
      list.appendChild(make('li', '', issues.length ? '当前筛选条件下没有异常。' : '没有需要你确认的异常。'));
      return;
    }
    for (const issue of filtered) {
      const item = document.createElement('li');
      item.appendChild(make('span', `badge ${issue.level === '严重' ? 'bad' : 'warn'}`, issue.level));
      item.appendChild(make('span', 'issue-text', `${issue.week ? issue.week + '　' : ''}${issue.msg}`));
      list.appendChild(item);
    }
  }

  function renderCheck(res) {
    const severe = res.issues.filter(issue => issue.level === '严重').length;
    const notices = res.issues.length - severe;
    const rooms = new Set(window.ROSTER.map(student => student.b + '#' + student.r)).size;
    $('checkSum').classList.toggle('bad', severe > 0);
    $('checkSum').textContent = severe
      ? `发现 ${severe} 处严重问题、${notices} 条提示。请先核对，不能直接上报。`
      : `未发现严重问题，${notices} 条提示供核对。已验证 ${window.ROSTER.length} 人、${rooms} 间寝室、${res.rank.length} 个班。`;
    $('issueCount').textContent = `共 ${res.issues.length} 条`;
    $('issueLevel').value = '';
    $('issueWeek').replaceChildren();
    const all = document.createElement('option');
    all.value = ''; all.textContent = '全部周次';
    $('issueWeek').appendChild(all);
    for (const week of res.weeks) {
      const option = document.createElement('option');
      option.value = week; option.textContent = week;
      $('issueWeek').appendChild(option);
    }
    $('issueLevel').onchange = () => renderIssues(res.issues);
    $('issueWeek').onchange = () => renderIssues(res.issues);
    renderIssues(res.issues);
    $('checkCard').classList.remove('hide');
  }

  function renderPreview(res) {
    const table = document.createElement('table');
    table.className = 'preview';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const headers = ['名次', '班级', ...res.weeks];
    if (res.weeks.length > 1) headers.push('平均');
    for (const text of headers) headRow.appendChild(make('th', '', text));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    res.rank.forEach((rank, index) => {
      const row = document.createElement('tr');
      if (index < 3) row.className = 'top';
      row.appendChild(make('td', '', index + 1));
      row.appendChild(make('td', 'l', rank.cls));
      for (const week of res.weeks) {
        const value = rank.per[week];
        row.appendChild(make('td', '', typeof value === 'number' ? value : '—'));
      }
      if (res.weeks.length > 1) row.appendChild(make('td', '', rank.overall ?? '—'));
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    $('preview').replaceChildren(table);
    $('previewCard').classList.remove('hide');
  }

  function renderManifest(zip) {
    const paths = Object.keys(zip.files).filter(path => !zip.files[path].dir && /\.xlsx$/i.test(path));
    const groups = new Map();
    for (const path of paths) {
      const parts = path.split('/');
      const label = parts.length === 2 ? '总表' : parts[1];
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(parts.slice(2).join('/') || parts[parts.length - 1]);
    }
    const box = $('manifest');
    box.replaceChildren();
    for (const [label, files] of groups) {
      const details = document.createElement('details');
      if (label === '总表') details.open = true;
      details.appendChild(make('summary', '', `${label} · ${files.length} 个文件`));
      const list = document.createElement('ul');
      files.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
      for (const file of files) list.appendChild(make('li', '', file));
      details.appendChild(list);
      box.appendChild(details);
    }
  }

  function renderDownload(res, blob) {
    const severe = res.issues.some(issue => issue.level === '严重');
    $('downInfo').textContent = `${res.count} 个表　${(blob.size / 1024 / 1024).toFixed(2)} MB`;
    $('downloadCount').textContent = `${res.count} 个 Excel 已生成`;
    $('downloadMeta').textContent = `${res.weeks.join('、')}　·　多次检查取平均　·　混合寝室照算`;
    $('download').disabled = severe;
    $('ackWrap').classList.toggle('hide', !severe);
    $('ackSevere').checked = false;
    $('ackSevere').onchange = event => { $('download').disabled = !event.target.checked; };
    renderManifest(res.zip);
    $('downCard').classList.remove('hide');
  }

  async function generate() {
    state.busy = true;
    updateRunState();
    setProgress(5, true);
    status('正在准备解析…');
    await waitForPaint();
    const progressMap = { read: 20, calc: 45, write: 70, zip: 90 };
    const groups = [...state.groups.entries()].map(([week, files]) => ({ week, files }));
    const res = await window.BUILD.buildAll(groups, (step, text) => {
      setProgress(progressMap[step] || 10, true);
      status(text);
    });
    renderCheck(res);
    renderPreview(res);
    status('正在打包…');
    const blob = await res.zip.generateAsync({
      type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 },
    });
    state.built = { blob, count: res.count, weeks: res.weeks };
    renderDownload(res, blob);
    setProgress(100, true);
    status('生成完成，请核对结果后下载', 'var(--color-ok)');
    updateSteps();
    await waitForPaint();
    const target = res.issues.some(issue => issue.level === '严重') ? $('checkCard') : $('downCard');
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  $('drop').onclick = () => $('file').click();
  $('drop').onkeydown = event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('file').click(); }
  };
  $('file').onchange = event => { collect(event.target.files); event.target.value = ''; };
  $('pickDir').onclick = () => $('dir').click();
  $('dir').onchange = event => { collect(event.target.files); event.target.value = ''; };

  document.addEventListener('paste', event => {
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const data = event.clipboardData;
    if (!data) return;
    if (data.files && data.files.length) { event.preventDefault(); collect(data.files); return; }
    const got = [];
    for (const item of Array.from(data.items || [])) {
      if (item.kind === 'file') {
        const file = item.getAsFile && item.getAsFile();
        if (file) got.push(file);
      }
    }
    if (got.length) { event.preventDefault(); collect(got); return; }
    const text = (data.getData && data.getData('text')) || '';
    if (text.trim()) status('粘贴的是文字，不是文件。请先复制文件本身，再回到这里粘贴', 'var(--color-warn)');
  });

  ['dragenter', 'dragover'].forEach(type => $('drop').addEventListener(type, event => {
    event.preventDefault(); $('drop').classList.add('hot');
  }));
  ['dragleave', 'drop'].forEach(type => $('drop').addEventListener(type, event => {
    event.preventDefault(); $('drop').classList.remove('hot');
  }));
  $('drop').addEventListener('drop', event => {
    const data = event.dataTransfer;
    if (data.files && data.files.length) { collect(data.files); return; }
    const items = data.items;
    if (!items || !items.length) { status('没有接收到文件，请点击选择', 'var(--color-bad)'); return; }
    const entries = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    const found = [];
    let pending = 0;
    const finish = () => { if (pending === 0) collect(found); };
    const walk = entry => {
      if (entry.isFile) {
        pending++;
        entry.file(file => { found.push(file); pending--; finish(); }, () => { pending--; finish(); });
      } else if (entry.isDirectory) {
        pending++;
        const reader = entry.createReader();
        const readBatch = () => reader.readEntries(list => {
          if (!list.length) { pending--; finish(); return; }
          list.forEach(walk);
          readBatch();
        }, () => { pending--; finish(); });
        readBatch();
      }
    };
    entries.forEach(walk);
    if (!pending) collect(found);
  });

  $('run').onclick = async () => {
    if (state.busy) return;
    try {
      await generate();
    } catch (error) {
      console.error(error);
      state.built = null;
      setProgress(0, false);
      status(`生成失败：${error.message}。请检查文件后重试`, 'var(--color-bad)');
      addNotice(`本次生成失败：${error.message}`);
    } finally {
      state.busy = false;
      updateRunState();
    }
  };

  $('reset').onclick = () => {
    if ((state.groups.size || state.built) && !window.confirm('确定清空当前导入和生成结果吗？原始文件不会被修改。')) return;
    state.groups.clear();
    state.built = null;
    state.notices = [];
    ['weeks', 'files', 'issues', 'preview', 'manifest'].forEach(id => $(id).replaceChildren());
    ['checkCard', 'previewCard', 'downCard'].forEach(id => $(id).classList.add('hide'));
    $('downInfo').textContent = '';
    setProgress(0, false);
    status('');
    updateRunState();
  };

  $('download').onclick = () => {
    if (!state.built || $('download').disabled) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(state.built.blob);
    link.download = `查寝得分汇总_${state.built.weeks.join('_')}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 30000);
  };

  updateRunState();
}());
