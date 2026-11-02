/* v13: exportação, importação e espelhamento exclusivo no servidor local. */
(function () {
    'use strict';

    const MODULES = [
        { id: 'banco_dados', title: 'Banco de Dados', description: 'Cadastro, avaliações dos atletas, fotos e documentos.' },
        { id: 'jogos', title: 'Jogos', description: 'Calendário, partidas, informações de jogos e equipes.' },
        { id: 'convocacoes', title: 'Convocações', description: 'Convocações, listas de atletas e escalações.' },
        { id: 'prancheta', title: 'Projetos da prancheta', description: 'Projetos e desenhos salvos na prancheta virtual.' },
        { id: 'psr', title: 'PSR', description: 'Respostas e configurações do questionário PSR.' },
        { id: 'pse', title: 'PSE', description: 'Respostas e configurações do questionário PSE.' },
        { id: 'preparacao', title: 'Preparação física', description: 'Preparação física, avaliações, controle de peso, trabalhos e planejamento.' },
        { id: 'outros', title: 'Outros dados e configurações', description: 'Demais tabelas, preferências e anexos locais conhecidos.' }
    ];

    const TABLE_MODULES = {
        sistema_config: ['banco_dados'],
        jogos: ['jogos'],
        calendario_jogos: ['jogos'],
        treinadores_jogos: ['jogos'],
        goleiros_informacoes_jogos: ['jogos'],
        convocacoes: ['convocacoes'],
        convocacoes_manuais: ['convocacoes'],
        calendario_jogo_convocados: ['convocacoes'],
        prancheta_projetos: ['prancheta'],
        respostas_diarias: ['psr', 'pse'],
        dias_treino_excecao: ['psr', 'pse'],
        preparacao_fisica_registros: ['preparacao'],
        goleiros_informacoes_tecnicas: ['preparacao'],
        controle_peso: ['preparacao'],
        avaliacao_diaria_notas: ['preparacao'],
        avaliacao_diaria_dias: ['preparacao'],
        atletas_extras_anos: ['preparacao'],
        trabalhos_diarios: ['preparacao'],
        planejamentos_semanais: ['preparacao'],
        documentos_acessos_locais: ['preparacao'],
        configuracoes_categorias: ['outros']
    };

    let storageQueue = Promise.resolve();
    let mirrorQueue = Promise.resolve();
    window.SA_LOCAL_SERVER_READY = false;

    function moduleForTable(name) {
        return TABLE_MODULES[name] || ['outros'];
    }
    function moduleForPreference(key) {
        if (key.startsWith('db:')) return moduleForTable(key.slice(3))[0];
        if (key === 'sa_site_categories_brand_v1' || key === 'sa_site_default_logo_version' || key === 'sa_mode') return 'banco_dados';
        if (/^sa_(convocacao|escalacao)/.test(key)) return 'convocacoes';
        if (/^sa_jogos_ativos/.test(key)) return 'jogos';
        if (/^sa_relatorio_psrpse/.test(key)) return 'psr';
        if (/peso|^sa_preparacao/i.test(key)) return 'preparacao';
        return 'outros';
    }
    function moduleForBucket(bucket) {
        if (bucket === 'fotos' || bucket === 'documentos-atletas') return 'banco_dados';
        if (bucket === 'trabalhos-diarios' || bucket === 'planejamentos-semanais') return 'preparacao';
        return 'outros';
    }
    function selectedHas(selected, module) {
        return Array.isArray(selected) && selected.includes(module);
    }
    function setStatus(message, state) {
        const el = document.getElementById('sa-local-server-status');
        if (!el) return;
        const reminder = el.querySelector('.sa-header-status-text');
        const reminderText = 'Não esqueça de EXPORTAR antes de sair';
        if (reminder) {
            // Mantém o lembrete de exportação visível; o status técnico fica no tooltip/acessibilidade.
            el.title = `${message}. ${reminderText}`;
            el.setAttribute('aria-label', `${reminderText}. Status da cópia local: ${message}`);
        } else {
            el.textContent = message;
            el.title = message;
            el.setAttribute('aria-label', message);
        }
        el.dataset.state = state || 'info';
    }
    function statusInModal(message, isError) {
        const el = document.querySelector('#sa-import-modal.is-open #sa-import-progress, #sa-export-modal.is-open #sa-backup-progress');
        if (!el) return;
        el.textContent = message || '';
        el.dataset.state = isError ? 'error' : 'info';
    }

    async function connect() {
        const localHost = ['localhost', '127.0.0.1', '::1'].includes(String(window.location && window.location.hostname || '').toLowerCase());
        if (!localHost) {
            window.SA_LOCAL_SERVER_READY = false;
            setStatus('Backup ZIP legado: disponível somente no servidor local do computador', 'warning');
            return false;
        }
        try {
            const response = await fetch('/api/status', { cache: 'no-store', credentials: 'same-origin' });
            if (!response.ok) throw new Error('Servidor local indisponível.');
            const result = await response.json();
            if (!result || result.ok !== true || String(result.appVersion) !== '13') throw new Error('Servidor local incompatível.');
            window.SA_LOCAL_SERVER_READY = true;
            setStatus('Servidor local conectado', 'ok');
            return true;
        } catch (error) {
            window.SA_LOCAL_SERVER_READY = false;
            setStatus('Dados no navegador — servidor local desconectado', 'warning');
            return false;
        }
    }

    function mirrorStorage(operation, key, value) {
        key = String(key);
        if (key === 'files_manifest' || key.startsWith('db:')) return Promise.resolve(false);
        if (!window.SA_LOCAL_SERVER_READY) return Promise.resolve(false);
        const run = async () => {
            const url = '/api/preferencias/' + encodeURIComponent(key);
            const response = operation === 'delete'
                ? await fetch(url, { method: 'DELETE', credentials: 'same-origin' })
                : await fetch(url, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key, value: String(value ?? '') }),
                    credentials: 'same-origin'
                });
            if (!response.ok) throw new Error('Falha ao espelhar uma preferência local.');
            return true;
        };
        storageQueue = storageQueue.catch(() => false).then(run).catch(error => {
            setStatus('Aviso: uma preferência não foi copiada para a pasta local', 'warning');
            console.warn('Espelhamento de preferência local:', error);
            return false;
        });
        return storageQueue;
    }

    async function mirrorTable(name, rows) {
        if (!window.SA_LOCAL_SERVER_READY) return false;
        try {
            const response = await fetch('/api/tables/' + encodeURIComponent(String(name)), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: String(name), rows: Array.isArray(rows) ? rows : [] }),
                credentials: 'same-origin'
            });
            if (!response.ok) throw new Error('Servidor recusou a tabela ' + name + '.');
            return true;
        } catch (error) {
            setStatus('Aviso: falha ao copiar uma tabela para Banco de Dados', 'warning');
            console.warn('Espelhamento da tabela local:', error);
            return false;
        }
    }

    function normalizedPhotoPath(path) {
        return String(path || '').replace(/^\.?\/?Fotos\//i, '').replace(/^\//, '');
    }
    function fileUrl(bucket, path) {
        const normalized = bucket === 'fotos' ? normalizedPhotoPath(path) : String(path || '');
        const segments = normalized.split('/').filter(Boolean).map(encodeURIComponent);
        return '/api/arquivos/' + encodeURIComponent(bucket) + '/' + segments.join('/');
    }
    async function mirrorFile(bucket, path, blob) {
        if (!window.SA_LOCAL_SERVER_READY) return false;
        try {
            const response = await fetch(fileUrl(String(bucket), String(path)), {
                method: 'PUT',
                headers: { 'Content-Type': blob && blob.type ? blob.type : 'application/octet-stream' },
                body: blob,
                credentials: 'same-origin'
            });
            if (!response.ok) throw new Error('Servidor recusou um arquivo local.');
            return true;
        } catch (error) {
            setStatus('Aviso: falha ao copiar um arquivo para a pasta local', 'warning');
            console.warn('Espelhamento de arquivo local:', error);
            return false;
        }
    }
    async function deleteMirroredFile(bucket, path) {
        if (!window.SA_LOCAL_SERVER_READY) return false;
        try {
            const response = await fetch(fileUrl(String(bucket), String(path)), { method: 'DELETE', credentials: 'same-origin' });
            return response.ok;
        } catch (_) { return false; }
    }

    function readIdbStore(db, storeName) {
        return new Promise((resolve, reject) => {
            let tx;
            try { tx = db.transaction(storeName, 'readonly'); }
            catch (error) { reject(error); return; }
            const request = tx.objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error || new Error('Falha ao ler o banco local.'));
        });
    }
    async function readAllTables() {
        const result = {};
        try {
            const db = typeof saLocalOpenDb === 'function' ? await saLocalOpenDb() : null;
            if (db) {
                const rows = await readIdbStore(db, 'tables');
                rows.forEach(item => { if (item && typeof item.name === 'string') result[item.name] = Array.isArray(item.rows) ? item.rows : []; });
                return result;
            }
        } catch (error) { console.warn('Leitura de tabelas para cópia:', error); }
        if (typeof SAStorage !== 'undefined' && SAStorage.exportAll) {
            const all = SAStorage.exportAll();
            Object.entries(all).forEach(([key, value]) => {
                if (!key.startsWith('db:')) return;
                try { const rows = JSON.parse(value); if (Array.isArray(rows)) result[key.slice(3)] = rows; } catch (_) {}
            });
        }
        return result;
    }
    function dataUrlToBlob(dataUrl) {
        const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(dataUrl || ''));
        if (!match) throw new Error('Foto local em formato inválido.');
        const mime = match[1] || 'application/octet-stream';
        const payload = match[3] || '';
        let bytes;
        if (match[2]) {
            const binary = atob(payload);
            const array = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
            bytes = array;
        } else {
            bytes = new TextEncoder().encode(decodeURIComponent(payload));
        }
        return new Blob([bytes], { type: mime });
    }
    async function readAllFiles() {
        const result = [];
        try {
            const db = typeof saLocalOpenDb === 'function' ? await saLocalOpenDb() : null;
            if (db) {
                const rows = await readIdbStore(db, 'files');
                rows.forEach(item => {
                    if (item && item.blob && typeof item.bucket === 'string' && typeof item.path === 'string') result.push(item);
                });
                return result;
            }
        } catch (error) { console.warn('Leitura de arquivos para cópia:', error); }
        if (typeof SAStorage !== 'undefined' && SAStorage.getItem) {
            try {
                const manifest = JSON.parse(SAStorage.getItem('files_manifest') || '{}');
                Object.entries(manifest).forEach(([key, value]) => {
                    const splitAt = key.indexOf('::');
                    if (splitAt < 1 || typeof value !== 'string' || !value.startsWith('data:')) return;
                    try { result.push({ bucket: key.slice(0, splitAt), path: key.slice(splitAt + 2), blob: dataUrlToBlob(value) }); } catch (_) {}
                });
            } catch (_) {}
        }
        return result;
    }

    async function flushPreferences() {
        await storageQueue.catch(() => false);
    }
    async function syncAll() {
        if (!window.SA_LOCAL_SERVER_READY) return false;
        let ok = true;
        setStatus('Copiando dados para Banco de Dados…', 'working');
        try {
            const tables = await readAllTables();
            for (const [name, rows] of Object.entries(tables)) {
                if (!(await mirrorTable(name, rows))) ok = false;
            }
            if (typeof SAStorage !== 'undefined' && SAStorage.exportAll) {
                const preferences = SAStorage.exportAll();
                for (const [key, value] of Object.entries(preferences)) {
                    if (key === 'files_manifest' || key.startsWith('db:')) continue;
                    const mirrored = await mirrorStorage('set', key, value);
                    if (!mirrored) ok = false;
                }
            }
            const files = await readAllFiles();
            for (const item of files) {
                if (!(await mirrorFile(item.bucket, item.path, item.blob))) ok = false;
            }
            await flushPreferences();
        } catch (error) {
            ok = false;
            console.warn('Sincronização inicial local:', error);
        }
        setStatus(ok ? 'Cópia espelhada em Banco de Dados e Fotos' : 'Aviso: cópia local parcialmente sincronizada', ok ? 'ok' : 'warning');
        return ok;
    }

    function renderModules(containerId, prefix) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = MODULES.map((module, index) => `
            <label class="sa-backup-module" for="${prefix}-${module.id}">
                <input id="${prefix}-${module.id}" type="checkbox" value="${module.id}" checked>
                <span class="sa-backup-check" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
                <span class="sa-backup-module-copy"><strong>${module.title}</strong><small>${module.description}</small></span>
            </label>`).join('');
    }
    function openModal(id, prefix, listId) {
        renderModules(listId, prefix);
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.add('is-open');
            modal.setAttribute('aria-hidden', 'false');
        }
        statusInModal('', false);
    }
    function closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('is-open');
            modal.setAttribute('aria-hidden', 'true');
        }
    }
    function selectAll(kind, checked) {
        const prefix = kind === 'import' ? 'sa-import' : 'sa-export';
        document.querySelectorAll(`#${prefix}-module-list input[type="checkbox"]`).forEach(input => { input.checked = !!checked; });
    }
    function selectedModules(kind) {
        const prefix = kind === 'import' ? 'sa-import' : 'sa-export';
        return Array.from(document.querySelectorAll(`#${prefix}-module-list input[type="checkbox"]:checked`)).map(input => input.value);
    }
    function labelsForModules(ids) {
        const label = Object.fromEntries(MODULES.map(module => [module.id, module.title]));
        return ids.map(id => label[id] || id).join(', ');
    }
    function showDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || 'SA_backup.zip';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    async function createPreImportBackup(modules) {
        const synchronized = await syncAll();
        if (!synchronized) throw new Error('Não foi possível sincronizar os dados atuais antes da substituição.');
        await flushPreferences();
        const response = await fetch('/api/exportar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modules }),
            credentials: 'same-origin'
        });
        const info = await response.json();
        if (!response.ok || !info.ok) throw new Error(info.error || 'Não foi possível criar a cópia de segurança anterior à substituição.');
        return info.path;
    }

    async function exportBackup() {
        const modules = selectedModules('export');
        if (!modules.length) return statusInModal('Marque ao menos um módulo.', true);
        if (!window.SA_LOCAL_SERVER_READY && !(await connect())) {
            return statusInModal('Inicie o sistema pelo arquivo iniciar_sa_local.py. Os dados do navegador não foram alterados.', true);
        }
        const button = document.getElementById('sa-export-confirm');
        if (button) button.disabled = true;
        statusInModal('Atualizando a cópia local antes de exportar…', false);
        try {
            const synchronized = await syncAll();
            if (!synchronized) throw new Error('A cópia local não foi sincronizada por completo. Confira o estado do servidor e tente novamente.');
            await flushPreferences();
            statusInModal('Preparando o arquivo de backup…', false);
            const response = await fetch('/api/exportar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modules }),
                credentials: 'same-origin'
            });
            const info = await response.json();
            if (!response.ok || !info.ok) throw new Error(info.error || 'Não foi possível exportar.');
            const download = await fetch(info.downloadUrl, { cache: 'no-store', credentials: 'same-origin' });
            if (!download.ok) throw new Error('Não foi possível baixar o arquivo de backup.');
            showDownload(await download.blob(), info.fileName);
            statusInModal(`Backup concluído: ${labelsForModules(info.modules)}. Uma cópia também foi guardada em ${info.path}.`, false);
            setStatus('Backup local concluído', 'ok');
        } catch (error) {
            console.error('Exportação local:', error);
            statusInModal(error.message || 'Falha ao exportar os dados.', true);
        } finally {
            if (button) button.disabled = false;
        }
    }

    function rowUniqueKey(table, row) {
        if (!row || typeof row !== 'object') return null;
        const natural = {
            sistema_config: ['chave'],
            prancheta_projetos: ['nome'],
            convocacoes: ['nome'],
            convocacoes_manuais: ['nome'],
            trabalhos_diarios: ['categoria_id'],
            planejamentos_semanais: ['categoria_id'],
            controle_peso: ['nome_completo', 'nascimento'],
            avaliacao_diaria_dias: ['data', 'categoria'],
            avaliacao_diaria_notas: ['data', 'categoria', 'atleta_key'],
            calendario_jogo_convocados: ['data', 'categoria'],
            dias_treino_excecao: ['data', 'categoria'],
            respostas_diarias: ['data', 'atleta_key'],
            calendario_jogos: ['data', 'categoria']
        }[table];
        if (natural && natural.every(field => row[field] !== undefined && row[field] !== null && row[field] !== '')) {
            return 'natural:' + natural.map(field => String(row[field])).join('|');
        }
        if (table === 'respostas_diarias' && row.data && row.nome_completo) {
            return 'atleta-dia:' + String(row.data) + '|' + String(row.nome_completo).trim().toLowerCase() + '|' + String(row.nascimento || '');
        }
        for (const field of ['id', 'chave']) if (row[field] !== undefined && row[field] !== null && row[field] !== '') return field + ':' + String(row[field]);
        if (row.data !== undefined && row.categoria !== undefined) return 'data-categoria:' + String(row.data) + '|' + String(row.categoria);
        if (row.categoria_id !== undefined) return 'categoria:' + String(row.categoria_id);
        if (row.data !== undefined && table !== 'sistema_config') return 'data:' + String(row.data);
        if (row.nome !== undefined && row.nome !== '') return 'nome:' + String(row.nome);
        return null;
    }
    function mergeRows(table, current, incoming) {
        const rows = Array.isArray(current) ? current.map(row => JSON.parse(JSON.stringify(row))) : [];
        const indexes = new Map();
        rows.forEach((row, index) => {
            const key = rowUniqueKey(table, row);
            if (key !== null) indexes.set(key, index);
        });
        (Array.isArray(incoming) ? incoming : []).forEach(row => {
            const key = rowUniqueKey(table, row);
            const index = key === null ? -1 : indexes.get(key);
            if (index !== undefined && index >= 0) rows[index] = { ...rows[index], ...row };
            else {
                const clone = row && typeof row === 'object' ? JSON.parse(JSON.stringify(row)) : row;
                rows.push(clone);
                if (key !== null) indexes.set(key, rows.length - 1);
            }
        });
        return rows;
    }
    function preserveUnselectedModuleFields(table, rows, selected) {
        if (table === 'respostas_diarias') {
            return rows.map(row => {
                if (!row || typeof row !== 'object') return row;
                const copy = { ...row };
                if (selectedHas(selected, 'psr') && !selectedHas(selected, 'pse')) delete copy.pse;
                if (selectedHas(selected, 'pse') && !selectedHas(selected, 'psr')) delete copy.psr;
                return copy;
            });
        }
        if (table === 'dias_treino_excecao') {
            return rows.map(row => {
                if (!row || typeof row !== 'object') return row;
                const copy = { ...row };
                if (selectedHas(selected, 'psr') && !selectedHas(selected, 'pse')) delete copy.pse_liberado;
                if (selectedHas(selected, 'pse') && !selectedHas(selected, 'psr')) delete copy.psr_liberado;
                return copy;
            });
        }
        return rows;
    }
    function combinePartialModuleTable(table, current, imported, selected) {
        const preserved = (Array.isArray(current) ? current : []).map(row => {
            if (!row || typeof row !== 'object') return row;
            const copy = { ...row };
            if (table === 'respostas_diarias') {
                if (selectedHas(selected, 'psr') && !selectedHas(selected, 'pse')) delete copy.psr;
                if (selectedHas(selected, 'pse') && !selectedHas(selected, 'psr')) delete copy.pse;
            } else if (table === 'dias_treino_excecao') {
                if (selectedHas(selected, 'psr') && !selectedHas(selected, 'pse')) delete copy.psr_liberado;
                if (selectedHas(selected, 'pse') && !selectedHas(selected, 'psr')) delete copy.pse_liberado;
            }
            return copy;
        });
        return mergeRows(table, preserved, preserveUnselectedModuleFields(table, imported, selected));
    }
    function isPartialSharedTable(table, selected) {
        return (table === 'respostas_diarias' || table === 'dias_treino_excecao') && (selectedHas(selected, 'psr') !== selectedHas(selected, 'pse'));
    }
    function preferenceMatchesModule(key, selected) {
        if (key === 'files_manifest' || key.startsWith('db:')) return false;
        const module = moduleForPreference(key);
        if (selectedHas(selected, module)) return true;
        return /^sa_relatorio_psrpse/.test(key) && (selectedHas(selected, 'psr') || selectedHas(selected, 'pse'));
    }
    function getCurrentFilesBySelectedModule(files, selected) {
        const grouped = new Map();
        files.forEach(item => {
            if (!item || !item.bucket || !item.path || !selectedHas(selected, moduleForBucket(item.bucket))) return;
            if (!grouped.has(item.bucket)) grouped.set(item.bucket, []);
            grouped.get(item.bucket).push(item.path);
        });
        return grouped;
    }
    async function applyImport(payload, selected, mode) {
        const dbTablesBefore = await readAllTables();
        const filesBefore = await readAllFiles();
        const currentPrefs = typeof SAStorage !== 'undefined' && SAStorage.exportAll ? SAStorage.exportAll() : {};

        if (mode === 'replace') {
            // Remove mirrored files in the local folders too, including files that are
            // present on disk but no longer referenced by the browser's file store.
            for (const entry of payload.clearFiles || []) {
                await deleteMirroredFile(entry.bucket, entry.path);
            }
            const currentByBucket = getCurrentFilesBySelectedModule(filesBefore, selected);
            for (const [bucket, paths] of currentByBucket) {
                const { error } = await _saData.storage.from(bucket).remove(paths);
                if (error) throw new Error(error.message || 'Não foi possível limpar os arquivos locais selecionados.');
            }
            const preferencesToClear = new Set([
                ...Object.keys(currentPrefs).filter(key => preferenceMatchesModule(key, selected)),
                ...(payload.clearStorageKeys || [])
            ]);
            for (const key of preferencesToClear) {
                if (key === 'files_manifest' || key.startsWith('db:')) continue;
                SAStorage.removeItem(key);
            }
        }

        const tableNames = new Set([
            ...(payload.clearTables || []),
            ...Object.keys(payload.tables || {}),
            ...Object.keys(dbTablesBefore)
        ]);
        for (const name of tableNames) {
            const modules = moduleForTable(name);
            if (!modules.some(module => selectedHas(selected, module))) continue;
            const incoming = Array.isArray(payload.tables && payload.tables[name]) ? payload.tables[name] : [];
            const current = Array.isArray(dbTablesBefore[name]) ? dbTablesBefore[name] : [];
            let next;
            if (mode === 'merge') {
                next = mergeRows(name, current, incoming);
            } else if (isPartialSharedTable(name, selected)) {
                next = combinePartialModuleTable(name, current, incoming, selected);
            } else {
                next = incoming;
            }
            await saLocalWriteTable(name, next);
        }

        for (const [key, value] of Object.entries(payload.storage || {})) {
            if (key.startsWith('db:') || key === 'files_manifest') continue;
            SAStorage.setItem(key, value);
        }

        for (const item of payload.files || []) {
            const blob = blobFromBase64(item.data, item.contentType);
            const { error } = await _saData.storage.from(item.bucket).upload(item.path, blob, {
                upsert: true,
                contentType: item.contentType || blob.type || 'application/octet-stream'
            });
            if (error) throw new Error(error.message || `Não foi possível restaurar o arquivo ${item.path}.`);
        }
        await flushPreferences();
        return { tables: tableNames.size, files: (payload.files || []).length };
    }
    function blobFromBase64(value, mime) {
        const binary = atob(String(value || ''));
        const chunks = [];
        const partSize = 64 * 1024;
        for (let start = 0; start < binary.length; start += partSize) {
            const part = binary.slice(start, start + partSize);
            const bytes = new Uint8Array(part.length);
            for (let i = 0; i < part.length; i++) bytes[i] = part.charCodeAt(i);
            chunks.push(bytes);
        }
        return new Blob(chunks, { type: mime || 'application/octet-stream' });
    }
    async function importBackup() {
        const input = document.getElementById('sa-import-file');
        const file = input && input.files ? input.files[0] : null;
        const requested = selectedModules('import');
        if (!file) return statusInModal('Selecione um arquivo de backup .zip.', true);
        if (!requested.length) return statusInModal('Marque ao menos um módulo.', true);
        if (!window.SA_LOCAL_SERVER_READY && !(await connect())) {
            return statusInModal('Inicie o sistema pelo arquivo iniciar_sa_local.py para importar o backup.', true);
        }
        const modeInput = document.querySelector('input[name="sa-import-mode"]:checked');
        const mode = modeInput ? modeInput.value : 'merge';
        const button = document.getElementById('sa-import-confirm');
        if (button) button.disabled = true;
        statusInModal('Lendo e validando o backup local…', false);
        try {
            const url = '/api/importar?modules=' + encodeURIComponent(JSON.stringify(requested));
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': file.type || 'application/zip' },
                body: file,
                credentials: 'same-origin'
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error || 'O arquivo de backup não pôde ser lido.');
            if (!window.confirm(`O arquivo contém estes módulos: ${labelsForModules(payload.modules)}.\n\nModo escolhido: ${mode === 'replace' ? 'SUBSTITUIR os módulos selecionados' : 'MESCLAR/ATUALIZAR os dados correspondentes'}.\n\nDeseja continuar?`)) {
                statusInModal('Importação cancelada; os dados atuais foram mantidos.', false);
                return;
            }
            if (mode === 'replace' && !window.confirm('ATENÇÃO: os dados locais dos módulos selecionados serão substituídos. Os módulos não selecionados serão mantidos. Deseja realmente substituir?')) {
                statusInModal('Substituição cancelada; os dados atuais foram mantidos.', false);
                return;
            }
            let safetyPath = '';
            if (mode === 'replace') {
                statusInModal('Criando uma cópia dos dados atuais antes de substituir…', false);
                safetyPath = await createPreImportBackup(payload.modules);
            }
            statusInModal(mode === 'replace' ? 'Substituindo os módulos selecionados…' : 'Mesclando e atualizando os dados…', false);
            const applied = await applyImport(payload, payload.modules, mode);
            const safetyNote = safetyPath ? ` Cópia anterior guardada em ${safetyPath}.` : '';
            statusInModal(`Importação concluída (${applied.tables} tabelas, ${applied.files} arquivos).${safetyNote} O sistema será recarregado.`, false);
            setStatus('Importação local concluída', 'ok');
            setTimeout(() => location.reload(), 700);
        } catch (error) {
            console.error('Importação local:', error);
            statusInModal(error.message || 'Falha ao importar o backup.', true);
        } finally {
            if (button) button.disabled = false;
        }
    }

    function bytesFromDataUrl(dataUrl) {
        return dataUrlToBlob(dataUrl);
    }
    function extensionForMime(mime) {
        const extensions = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg' };
        return extensions[String(mime).toLowerCase()] || 'img';
    }
    async function storePhotoDataUrl(dataUrl) {
        if (!/^data:image\//i.test(String(dataUrl || ''))) return null;
        if (!window.SA_LOCAL_SERVER_READY) return null;
        const blob = bytesFromDataUrl(dataUrl);
        const mime = blob.type || 'image/jpeg';
        const uuid = window.crypto && typeof window.crypto.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        const path = `atleta_${Date.now()}_${uuid}.${extensionForMime(mime)}`;
        const { error } = await _saData.storage.from('fotos').upload(path, blob, { upsert: true, contentType: mime });
        if (error) throw new Error(error.message || 'Não foi possível gravar a foto na pasta Fotos.');
        return 'Fotos/' + path;
    }
    async function migrateLegacyPhotos() {
        if (!window.SA_LOCAL_SERVER_READY || typeof excelData === 'undefined' || !Array.isArray(excelData)) return 0;
        const rows = excelData;
        let changed = false;
        let count = 0;
        for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            const field = ['Foto', 'foto', 'imagem'].find(key => typeof row[key] === 'string' && row[key].startsWith('data:image/'));
            if (!field) continue;
            try {
                const savedPath = await storePhotoDataUrl(row[field]);
                if (savedPath) { row[field] = savedPath; changed = true; count++; }
            } catch (error) {
                console.warn('Migração de foto antiga:', error);
                setStatus('Aviso: algumas fotos antigas não foram copiadas para Fotos', 'warning');
            }
        }
        if (changed) {
            const result = await _saData.from('sistema_config').upsert({
                chave: 'principal',
                colunas: typeof excelColumns !== 'undefined' && Array.isArray(excelColumns) ? excelColumns : [],
                dados: rows,
                atualizado_em: new Date().toISOString()
            }, { onConflict: 'chave' });
            if (result.error) throw new Error(result.error.message || 'Não foi possível atualizar os caminhos das fotos migradas.');
        }
        return count;
    }

    window.saBackupConnect = connect;
    window.saBackupSyncAll = syncAll;
    window.saBackupMirrorStorage = mirrorStorage;
    window.saBackupMirrorTable = mirrorTable;
    window.saBackupMirrorFile = mirrorFile;
    window.saBackupDeleteFile = deleteMirroredFile;
    window.saBackupFlushPreferences = flushPreferences;
    window.saBackupMigrateLegacyPhotos = migrateLegacyPhotos;
    window.saBackupStorePhotoDataUrl = storePhotoDataUrl;
    window.saBackupOpenExport = () => openModal('sa-export-modal', 'sa-export', 'sa-export-module-list');
    window.saBackupOpenImport = () => {
        const input = document.getElementById('sa-import-file');
        const mergeOption = document.querySelector('input[name="sa-import-mode"][value="merge"]');
        if (input) input.value = '';
        if (mergeOption) mergeOption.checked = true;
        openModal('sa-import-modal', 'sa-import', 'sa-import-module-list');
    };
    window.saBackupCloseModal = closeModal;
    window.saBackupSetAll = selectAll;
    window.saBackupExport = exportBackup;
    window.saBackupImport = importBackup;
})();
