/* V14 — banco completo em JSON no navegador. Dados esportivos nunca são enviados à rede. */
(function () {
    'use strict';

    const DATABASE_FORMAT = 'VBOLONHEZE_SA_FULL_DATABASE';
    const DATABASE_FORMAT_VERSION = 1;
    const AUTO_ENTER_KEY = 'sa_database_json_auto_enter_v1';
    const AUTO_NOTICE_KEY = 'sa_database_json_auto_notice_v1';
    const INTERNAL_STORAGE_KEYS = new Set(['files_manifest']);
    let operationInProgress = false;
    let reminderShown = false;

    const byId = id => document.getElementById(id);
    const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

    function setStatus(message, state = 'info') {
        const text = String(message || '');
        ['sa-database-entry-status', 'sa-export-reminder-status'].forEach(id => {
            const element = byId(id);
            if (!element) return;
            element.textContent = text;
            element.dataset.state = state;
        });
    }

    function setBusy(isBusy) {
        operationInProgress = !!isBusy;
        ['sa-database-entry-close', 'sa-export-reminder-close', 'sa-export-reminder-continue'].forEach(id => {
            const button = byId(id);
            if (button) button.disabled = operationInProgress;
        });
        document.querySelectorAll('.sa-header-full-database, .sa-database-option-button').forEach(button => {
            button.disabled = operationInProgress;
        });
        const fileInput = byId('sa-database-json-input');
        if (fileInput) fileInput.disabled = operationInProgress;
    }

    function openOverlay() {
        const overlay = byId('sa-database-entry-modal');
        if (!overlay) throw new Error('A janela de escolha do banco não foi encontrada. Atualize a página.');
        overlay.classList.add('is-open');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('sa-database-modal-open');
        const close = byId('sa-database-entry-close');
        if (close) setTimeout(() => close.focus(), 0);
    }

    function closeOverlay() {
        if (operationInProgress) return;
        const overlay = byId('sa-database-entry-modal');
        if (overlay) {
            overlay.classList.remove('is-open');
            overlay.setAttribute('aria-hidden', 'true');
        }
        document.body.classList.remove('sa-database-modal-open');
        const returnFocus = byId('sa-trial-button');
        if (returnFocus) returnFocus.focus();
    }

    async function waitForAppReady() {
        if (window.SA_READY && typeof window.SA_READY.then === 'function') await window.SA_READY;
    }

    async function openDatabaseEntry(context = 'trial') {
        try {
            await waitForAppReady();
            const title = byId('sa-database-entry-title');
            const eyebrow = byId('sa-database-entry-eyebrow');
            if (title) title.textContent = context === 'active' ? 'Selecionar banco de dados' : 'Como deseja abrir o SA?';
            if (eyebrow) eyebrow.textContent = context === 'active' ? 'Banco local' : 'Teste grátis';
            openOverlay();
            setStatus('Escolha importar um JSON, abrir os dados locais salvos ou começar com um banco novo.', 'info');
        } catch (error) {
            console.error('Preparação da tela de banco local:', error);
            setStatus(error.message || 'Não foi possível abrir as opções do banco.', 'error');
            openOverlay();
        }
    }

    async function openBrowserCache() {
        if (operationInProgress) return;
        setBusy(true);
        try {
            // startFreeTrial aguarda SA_READY antes de abrir este menu; o banco local já foi carregado do IndexedDB/localStorage.
            await waitForAppReady();
            if (typeof SAStorage === 'undefined' || typeof SAStorage.setItem !== 'function') {
                throw new Error('O armazenamento local do navegador não está disponível.');
            }
            if (typeof enterSystem !== 'function') throw new Error('A tela principal do SA não foi carregada. Atualize a página e tente novamente.');
            SAStorage.setItem('sa_mode', 'free_trial');
            if (SAStorage.getItem('sa_mode') !== 'free_trial') throw new Error('Não foi possível ativar o acesso local do SA.');
            setStatus('Abrindo os dados já salvos neste navegador, sem apagar o banco…', 'success');
            setBusy(false);
            closeOverlay();
            enterSystem();
        } catch (error) {
            console.error('Abertura dos dados locais do navegador:', error);
            const message = error.message || 'Não foi possível abrir os dados salvos neste navegador.';
            setStatus(message, 'error');
            setBusy(false);
            alert(message);
        }
    }

    async function getLocalDatabase() {
        if (typeof saLocalOpenDb !== 'function') return null;
        try { return await saLocalOpenDb(); }
        catch (_) { return null; }
    }

    function readIdbStore(db, storeName) {
        return new Promise((resolve, reject) => {
            let transaction;
            try { transaction = db.transaction(storeName, 'readonly'); }
            catch (error) { reject(error); return; }
            const request = transaction.objectStore(storeName).getAll();
            request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
            request.onerror = () => reject(request.error || new Error('Não foi possível ler o banco do navegador.'));
            transaction.onerror = () => reject(transaction.error || new Error('Falha ao ler o banco do navegador.'));
            transaction.onabort = () => reject(transaction.error || new Error('A leitura do banco foi cancelada.'));
        });
    }

    function dataUrlToBlob(dataUrl) {
        const raw = String(dataUrl || '');
        const comma = raw.indexOf(',');
        if (!/^data:/i.test(raw) || comma < 0) throw new Error('Arquivo local em formato inválido.');
        const header = raw.slice(0, comma);
        const mimeMatch = /^data:([^;,]+)/i.exec(header);
        const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
        const body = raw.slice(comma + 1);
        if (/;base64/i.test(header)) return base64ToBlob(body, mime);
        return new Blob([decodeURIComponent(body)], { type: mime });
    }

    function base64ToBlob(value, contentType) {
        const encoded = String(value || '').replace(/\s+/g, '');
        if (encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
            throw new Error('O arquivo do backup contém Base64 inválido.');
        }
        const binary = encoded ? atob(encoded) : '';
        const chunks = [];
        const partSize = 64 * 1024;
        for (let start = 0; start < binary.length; start += partSize) {
            const part = binary.slice(start, start + partSize);
            const bytes = new Uint8Array(part.length);
            for (let i = 0; i < part.length; i++) bytes[i] = part.charCodeAt(i);
            chunks.push(bytes);
        }
        return new Blob(chunks, { type: contentType || 'application/octet-stream' });
    }

    async function blobToBase64(blob) {
        if (!(blob instanceof Blob)) throw new Error('Um arquivo salvo no navegador não pôde ser lido.');
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = String(reader.result || '');
                const comma = dataUrl.indexOf(',');
                if (comma < 0) reject(new Error('Não foi possível codificar um arquivo do banco.'));
                else resolve(dataUrl.slice(comma + 1));
            };
            reader.onerror = () => reject(reader.error || new Error('Não foi possível ler um arquivo do banco.'));
            reader.readAsDataURL(blob);
        });
    }

    function parseFallbackTables(storage, tables) {
        Object.entries(storage || {}).forEach(([key, value]) => {
            if (!key.startsWith('db:')) return;
            const tableName = key.slice(3);
            if (!tableName) throw new Error('Foi encontrada uma tabela local sem nome. Exporte o banco em um navegador compatível.');
            if (hasOwn(tables, tableName)) return;
            let rows;
            try { rows = JSON.parse(value); }
            catch (_) { throw new Error(`A tabela local “${tableName}” está corrompida e não pode ser incluída com segurança.`); }
            if (!Array.isArray(rows)) throw new Error(`A tabela local “${tableName}” não contém uma lista válida.`);
            tables[tableName] = rows;
        });
    }

    function parseFallbackFiles(storage, files, existingKeys) {
        let manifest = {};
        try { manifest = JSON.parse(storage && storage.files_manifest || '{}'); }
        catch (_) { throw new Error('O índice de fotos/arquivos locais está corrompido; a exportação foi interrompida para evitar um backup incompleto.'); }
        if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('O índice de fotos/arquivos locais está em formato inválido.');
        Object.entries(manifest).forEach(([key, dataUrl]) => {
            const divider = key.indexOf('::');
            if (divider < 1 || typeof dataUrl !== 'string' || !/^data:/i.test(dataUrl)) throw new Error('Um arquivo do cache local não pôde ser identificado para o backup.');
            const bucket = key.slice(0, divider);
            const path = key.slice(divider + 2);
            const fileKey = `${bucket}::${path}`;
            if (!bucket || !path || existingKeys.has(fileKey)) return;
            const blob = dataUrlToBlob(dataUrl);
            files.push({ key: fileKey, bucket, path, contentType: blob.type || 'application/octet-stream', blob });
            existingKeys.add(fileKey);
        });
    }

    async function readCurrentState() {
        const storage = typeof SAStorage !== 'undefined' && SAStorage.exportAll ? SAStorage.exportAll() : {};
        const tables = Object.create(null);
        const files = [];
        const db = await getLocalDatabase();
        if (db) {
            const tableRows = await readIdbStore(db, 'tables');
            tableRows.forEach(item => {
                if (!item || typeof item.name !== 'string' || !item.name || !Array.isArray(item.rows)) {
                    throw new Error('Uma tabela do IndexedDB está em formato inválido; o backup foi interrompido para evitar perda de dados.');
                }
                tables[item.name] = item.rows;
            });
            const fileRows = await readIdbStore(db, 'files');
            const existingFileKeys = new Set();
            fileRows.forEach(item => {
                if (!item || typeof item.bucket !== 'string' || typeof item.path !== 'string' || !(item.blob instanceof Blob)) {
                    throw new Error('Um arquivo do IndexedDB está em formato inválido; o backup foi interrompido para evitar perda de dados.');
                }
                const key = item.key || `${item.bucket}::${item.path}`;
                files.push({
                    key,
                    bucket: item.bucket,
                    path: item.path,
                    contentType: item.contentType || item.blob.type || 'application/octet-stream',
                    blob: item.blob
                });
                existingFileKeys.add(key);
            });
            parseFallbackTables(storage, tables);
            parseFallbackFiles(storage, files, existingFileKeys);
        } else {
            parseFallbackTables(storage, tables);
            parseFallbackFiles(storage, files, new Set());
        }
        return { tables, preferences: storage, files, databaseAccessible: !!db };
    }

    function getAthleteCount(tables) {
        const rows = Array.isArray(tables && tables.sistema_config) ? tables.sistema_config : [];
        const main = rows.find(row => row && String(row.chave || '') === 'principal');
        return main && Array.isArray(main.dados) ? main.dados.length : 0;
    }

    function summarizeState(state) {
        const tables = state && state.tables || {};
        const tableNames = Object.keys(tables);
        const recordCount = tableNames.reduce((sum, name) => sum + (Array.isArray(tables[name]) ? tables[name].length : 0), 0);
        const preferences = state && state.preferences || {};
        const preferenceCount = Object.keys(preferences).filter(key => key !== 'sa_mode' && !key.startsWith('db:') && key !== 'files_manifest').length;
        const files = Array.isArray(state && state.files) ? state.files : [];
        const fileBytes = files.reduce((sum, item) => sum + (item.blob instanceof Blob ? item.blob.size : Number(item.size) || 0), 0);
        return {
            athleteCount: getAthleteCount(tables),
            tableCount: tableNames.length,
            recordCount,
            fileCount: files.length,
            fileBytes,
            preferenceCount,
            hasData: recordCount > 0 || files.length > 0 || preferenceCount > 0
        };
    }

    function formatBytes(bytes) {
        const size = Number(bytes) || 0;
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
        return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    function safeTableName(value) {
        const name = String(value || '');
        if (!/^[A-Za-z0-9_-]{1,120}$/.test(name)) throw new Error(`Nome de tabela inválido no JSON: ${name.slice(0, 40)}`);
        return name;
    }

    function safeStorageKey(value) {
        const key = String(value || '');
        if (!key || key.length > 512 || /[\u0000-\u001f]/.test(key)) throw new Error('Uma preferência do JSON tem uma chave inválida.');
        return key;
    }

    function safeFileLocation(bucketValue, pathValue) {
        const bucket = String(bucketValue || '');
        const path = String(pathValue || '');
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(bucket)) throw new Error('O backup contém um arquivo com pasta/bucket inválido.');
        if (!path || path.length > 1500 || path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f]/.test(path)) {
            throw new Error('O backup contém um caminho de arquivo inválido.');
        }
        if (path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('O backup contém um caminho de arquivo inseguro.');
        return { bucket, path };
    }

    function safeContentType(value) {
        const contentType = String(value || 'application/octet-stream');
        if (contentType.length > 200 || /[\r\n]/.test(contentType)) throw new Error('O tipo de conteúdo de um arquivo no JSON é inválido.');
        return contentType;
    }

    function normalizeImportPayload(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('O arquivo selecionado não contém um banco JSON válido.');
        if (raw.format !== DATABASE_FORMAT || Number(raw.formatVersion) !== DATABASE_FORMAT_VERSION) {
            throw new Error('Este JSON não é um backup completo compatível do VBolonheze Sports. Os arquivos ZIP legados usam a opção de compatibilidade separada.');
        }
        if (!raw.tables || typeof raw.tables !== 'object' || Array.isArray(raw.tables)) throw new Error('O JSON não contém a seção de tabelas do banco.');
        const tables = Object.create(null);
        Object.entries(raw.tables).forEach(([rawName, rows]) => {
            const name = safeTableName(rawName);
            if (!Array.isArray(rows)) throw new Error(`A tabela “${name}” não contém uma lista de registros válida.`);
            tables[name] = rows;
        });

        const rawPreferences = raw.preferences || raw.storage || {};
        if (!rawPreferences || typeof rawPreferences !== 'object' || Array.isArray(rawPreferences)) throw new Error('As preferências do JSON estão em formato inválido.');
        const preferences = Object.create(null);
        Object.entries(rawPreferences).forEach(([rawKey, value]) => {
            const key = safeStorageKey(rawKey);
            if (key.startsWith('db:') || INTERNAL_STORAGE_KEYS.has(key)) return;
            if (typeof value !== 'string') throw new Error(`A preferência “${key}” não está armazenada como texto válido.`);
            preferences[key] = value;
        });

        if (raw.files !== undefined && !Array.isArray(raw.files)) throw new Error('A seção de arquivos do JSON está em formato inválido.');
        const files = [];
        const seenFiles = new Set();
        (raw.files || []).forEach(item => {
            if (!item || typeof item !== 'object') throw new Error('O JSON contém um arquivo em formato inválido.');
            const { bucket, path } = safeFileLocation(item.bucket, item.path);
            const key = `${bucket}::${path}`;
            if (seenFiles.has(key)) throw new Error(`O backup contém o arquivo duplicado “${path}”.`);
            seenFiles.add(key);
            const contentType = safeContentType(item.contentType);
            if (typeof item.data !== 'string') throw new Error(`O arquivo “${path}” não contém os dados codificados.`);
            // Decodifica durante a validação, antes de limpar qualquer dado atual.
            const blob = base64ToBlob(item.data, contentType);
            files.push({ key, bucket, path, contentType, data: item.data, blob });
        });
        return { tables, preferences, files };
    }

    function chooseImportFile() {
        if (operationInProgress) return;
        const input = byId('sa-database-json-input');
        if (!input) {
            setStatus('O seletor de arquivo não foi encontrado.', 'error');
            return;
        }
        input.value = '';
        input.click();
    }

    async function readFileText(file) {
        if (file && typeof file.text === 'function') return file.text();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Não foi possível ler o arquivo selecionado.'));
            reader.readAsText(file, 'utf-8');
        });
    }

    async function handleImportFile(event) {
        const input = event && event.target;
        const file = input && input.files && input.files[0];
        if (!file || operationInProgress) return;
        setBusy(true);
        let reloadScheduled = false;
        setStatus(`Lendo “${file.name}”…`, 'working');
        try {
            const text = await readFileText(file);
            const raw = JSON.parse(String(text).replace(/^\uFEFF/, ''));
            const payload = normalizeImportPayload(raw);
            setStatus('Importando o banco completo e abrindo o sistema…', 'working');
            await requestPersistentStorage();
            scheduleAutoEnter('Banco JSON importado. Antes de sair do SA, exporte o banco completo atualizado.');
            await replaceWholeDatabase(payload);
            setStatus('Banco importado. Abrindo…', 'success');
            reloadScheduled = true;
            setTimeout(() => { window.__SA_SKIP_BEFOREUNLOAD = true; location.reload(); }, 250);
        } catch (error) {
            clearScheduledAutoEnter();
            console.error('Importação do banco JSON:', error);
            const message = error.message || 'O arquivo JSON não pôde ser importado. Nenhum dado atual foi alterado.';
            setStatus(message, 'error');
            alert(message);
        } finally {
            if (input) input.value = '';
            if (!reloadScheduled) setBusy(false);
        }
    }

    async function startEmptyDatabase() {
        if (operationInProgress) return;
        setBusy(true);
        let reloadScheduled = false;
        setStatus('Preparando um banco vazio…', 'working');
        try {
            await requestPersistentStorage();
            scheduleAutoEnter('Banco novo iniciado. Antes de sair do SA, exporte o banco completo atualizado.');
            await clearWholeDatabase();
            setStatus('Banco vazio pronto. Abrindo…', 'success');
            reloadScheduled = true;
            setTimeout(() => { window.__SA_SKIP_BEFOREUNLOAD = true; location.reload(); }, 250);
        } catch (error) {
            clearScheduledAutoEnter();
            console.error('Início de banco vazio:', error);
            const message = error.message || 'Não foi possível iniciar um banco vazio.';
            setStatus(message, 'error');
            alert(message);
        } finally {
            if (!reloadScheduled) setBusy(false);
        }
    }

    async function requestPersistentStorage() {
        try {
            if (navigator.storage && typeof navigator.storage.persist === 'function') {
                await navigator.storage.persist();
            }
        } catch (_) {}
    }

    function replaceIdbDatabase(db, tables, files) {
        return new Promise((resolve, reject) => {
            let transaction;
            try { transaction = db.transaction(['tables', 'files'], 'readwrite'); }
            catch (error) { reject(error); return; }
            transaction.objectStore('tables').clear();
            transaction.objectStore('files').clear();
            Object.entries(tables).forEach(([name, rows]) => transaction.objectStore('tables').put({ name, rows }));
            files.forEach(item => transaction.objectStore('files').put({
                key: item.key,
                bucket: item.bucket,
                path: item.path,
                blob: item.blob,
                contentType: item.contentType || item.blob.type || 'application/octet-stream'
            }));
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error || new Error('O navegador não conseguiu gravar o banco importado.'));
            transaction.onabort = () => reject(transaction.error || new Error('A gravação do banco importado foi cancelada.'));
        });
    }

    function restoreStorageSnapshot(snapshot) {
        if (typeof SAStorage === 'undefined') return;
        try {
            SAStorage.clear();
            Object.entries(snapshot || {}).forEach(([key, value]) => SAStorage.setItem(key, value));
        } catch (error) {
            console.error('Restauração de preferências após falha:', error);
        }
    }

    function writeStorageSnapshot(snapshot) {
        if (typeof SAStorage === 'undefined' || typeof SAStorage.clear !== 'function') throw new Error('O armazenamento de preferências deste navegador não está disponível.');
        SAStorage.clear();
        Object.entries(snapshot || {}).forEach(([key, value]) => SAStorage.setItem(key, String(value)));
    }

    async function replaceWholeDatabase(payload) {
        const oldStorage = typeof SAStorage !== 'undefined' && SAStorage.exportAll ? SAStorage.exportAll() : {};
        const db = await getLocalDatabase();
        const preferences = Object.create(null);
        Object.entries(payload.preferences || {}).forEach(([key, value]) => {
            if (!key.startsWith('db:') && !INTERNAL_STORAGE_KEYS.has(key)) preferences[key] = value;
        });
        if (!hasOwn(preferences, 'sa_mode')) preferences.sa_mode = 'free_trial';
        if (db && typeof SAStorage !== 'undefined' && !SAStorage.persistent && Object.keys(preferences).length) {
            throw new Error('O navegador não permite salvar as preferências localmente. O banco atual foi mantido; habilite o armazenamento deste site ou tente em outro navegador.');
        }

        const previousServerState = window.SA_LOCAL_SERVER_READY;
        // A troca completa pertence ao cache do navegador; evita efeitos paralelos do espelhamento legado.
        window.SA_LOCAL_SERVER_READY = false;
        try {
            if (db) {
                // Atualiza preferências primeiro; se a transação do IndexedDB falhar, restaura o snapshot anterior.
                try { writeStorageSnapshot(preferences); }
                catch (error) {
                    restoreStorageSnapshot(oldStorage);
                    throw new Error(`Não foi possível substituir as preferências locais; os dados atuais foram preservados. ${error.message || ''}`);
                }
                try {
                    await replaceIdbDatabase(db, payload.tables, payload.files);
                } catch (error) {
                    restoreStorageSnapshot(oldStorage);
                    throw new Error(`A importação não foi concluída; o banco de dados atual foi preservado. ${error.message || ''}`);
                }
            } else {
                if (typeof SAStorage === 'undefined' || !SAStorage.persistent) {
                    throw new Error('Este navegador não oferece armazenamento persistente suficiente para importar o banco. Tente em um navegador atualizado e fora do modo privado.');
                }
                const fallback = Object.create(null);
                Object.entries(preferences).forEach(([key, value]) => { fallback[key] = value; });
                Object.entries(payload.tables).forEach(([name, rows]) => { fallback[`db:${name}`] = JSON.stringify(rows); });
                const manifest = Object.create(null);
                payload.files.forEach(item => { manifest[`${item.bucket}::${item.path}`] = `data:${item.contentType};base64,${item.data}`; });
                if (payload.files.length) fallback.files_manifest = JSON.stringify(manifest);
                try { writeStorageSnapshot(fallback); }
                catch (error) {
                    restoreStorageSnapshot(oldStorage);
                    throw new Error(`O banco importado excede o espaço persistente disponível. Os dados atuais foram restaurados. ${error.message || ''}`);
                }
            }
        } finally {
            window.SA_LOCAL_SERVER_READY = previousServerState;
        }
    }

    async function clearWholeDatabase() {
        const oldStorage = typeof SAStorage !== 'undefined' && SAStorage.exportAll ? SAStorage.exportAll() : {};
        const db = await getLocalDatabase();
        const previousServerState = window.SA_LOCAL_SERVER_READY;
        window.SA_LOCAL_SERVER_READY = false;
        try {
            if (!db && typeof SAStorage !== 'undefined' && !SAStorage.persistent) {
                throw new Error('Este navegador não oferece armazenamento local persistente. O banco atual não foi alterado.');
            }
            try {
                if (typeof SAStorage !== 'undefined') SAStorage.clear();
            } catch (error) {
                restoreStorageSnapshot(oldStorage);
                throw new Error(`Não foi possível limpar as preferências locais. ${error.message || ''}`);
            }
            if (db) {
                try { await replaceIdbDatabase(db, Object.create(null), []); }
                catch (error) {
                    restoreStorageSnapshot(oldStorage);
                    throw new Error(`Não foi possível limpar o banco; os dados atuais foram preservados. ${error.message || ''}`);
                }
            }
        } finally {
            window.SA_LOCAL_SERVER_READY = previousServerState;
        }
    }

    function scheduleAutoEnter(notice) {
        try {
            sessionStorage.setItem(AUTO_ENTER_KEY, '1');
            sessionStorage.setItem(AUTO_NOTICE_KEY, String(notice || 'Banco pronto.'));
        } catch (_) {
            throw new Error('O navegador bloqueou a sessão temporária necessária para abrir o banco após a troca. Libere o armazenamento deste site e tente novamente.');
        }
    }

    function clearScheduledAutoEnter() {
        try {
            sessionStorage.removeItem(AUTO_ENTER_KEY);
            sessionStorage.removeItem(AUTO_NOTICE_KEY);
        } catch (_) {}
    }

    // O arquivo só é oferecido depois de estar pronto. O segundo toque é um
    // gesto direto do usuário, mais compatível com navegadores de celular.
    let preparedExportUrl = null;
    let preparedExportFile = null;
    let exportDialog = null;

    function ensureExportDialog() {
        if (exportDialog) return exportDialog;
        const overlay = document.createElement('div');
        overlay.id = 'sa-json-ready-dialog';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'sa-json-ready-title');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(4,18,30,.72);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;';
        const card = document.createElement('section');
        card.style.cssText = 'box-sizing:border-box;width:min(100%,520px);max-height:90vh;overflow:auto;background:#fff;color:#173b59;border-radius:18px;padding:22px;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 16px 50px #0005;';
        card.innerHTML = '<h2 id="sa-json-ready-title" style="margin:0 0 8px;font-size:21px">JSON pronto para salvar</h2>' +
          '<p data-role="summary" style="margin:0 0 10px"></p>' +
          '<p data-role="warning" style="margin:0 0 12px;color:#92400e;font-weight:600" hidden></p>' +
          '<p style="margin:0 0 15px">Toque em <strong>Baixar JSON</strong>. Depois, confira na pasta Downloads se o arquivo tem tamanho maior que 0 bytes. O download não altera os dados do sistema.</p>' +
          '<div style="display:flex;flex-wrap:wrap;gap:10px">' +
          '<a data-role="download" download="SA_Banco_Completo.json" style="display:inline-block;background:#076d72;color:white;padding:11px 17px;border-radius:9px;text-decoration:none;font-weight:700">Baixar JSON</a>' +
          '<button type="button" data-role="share" hidden style="border:0;background:#173b59;color:white;padding:11px 17px;border-radius:9px;font:inherit;font-weight:700;cursor:pointer">Compartilhar arquivo</button>' +
          '<button type="button" data-role="saveas" hidden style="border:1px solid #8ba7b6;background:white;color:#173b59;padding:10px 16px;border-radius:9px;font:inherit;font-weight:700;cursor:pointer">Salvar como…</button>' +
          '<button type="button" data-role="close" style="border:1px solid #8ba7b6;background:white;color:#173b59;padding:10px 16px;border-radius:9px;font:inherit;cursor:pointer">Fechar</button></div>' +
          '<p data-role="status" aria-live="polite" style="margin:14px 0 0;font-size:14px"></p>';
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        const at = role => card.querySelector(`[data-role="${role}"]`);
        const status = at('status');
        const download = at('download');
        const share = at('share');
        const saveas = at('saveas');
        const close = () => { overlay.style.display = 'none'; };
        at('close').addEventListener('click', close);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
        download.addEventListener('click', () => {
            status.textContent = 'Download solicitado. Verifique o arquivo salvo; o navegador pode pedir confirmação.';
        });
        share.addEventListener('click', async () => {
            try {
                // File já está criado antes do clique. Nada é enviado sem a escolha do usuário.
                await navigator.share({ files: [preparedExportFile], title: 'Banco completo SA' });
                status.textContent = 'Compartilhamento solicitado. Confira o arquivo no destino escolhido.';
            } catch (error) {
                if (error && error.name === 'AbortError') status.textContent = 'Compartilhamento cancelado. O arquivo continua disponível para baixar.';
                else status.textContent = 'Não foi possível compartilhar. Use Baixar JSON ou tente outro navegador.';
            }
        });
        saveas.addEventListener('click', async () => {
            try {
                // A janela só é aberta após a geração e em resposta direta a este clique.
                const handle = await window.showSaveFilePicker({ suggestedName: 'SA_Banco_Completo.json', startIn: 'downloads', types: [{description:'Banco completo SA (JSON)',accept:{'application/json':['.json']}}] });
                const writable = await handle.createWritable();
                try { await writable.write(preparedExportFile); await writable.close(); }
                catch (error) { try { await writable.abort(); } catch (_) {} throw error; }
                status.textContent = 'Gravação concluída. Confira o arquivo no local escolhido.';
            } catch (error) {
                status.textContent = error && error.name === 'AbortError' ? 'Operação cancelada. O arquivo continua disponível para baixar.' : 'Não foi possível gravar. Use Baixar JSON e confira o arquivo no destino.';
            }
        });
        exportDialog = { overlay, summary: at('summary'), warning: at('warning'), status, download, share, saveas };
        return exportDialog;
    }

    function showPreparedExport(blob, summary, databaseAccessible) {
        if (!blob || !blob.size) throw new Error('O JSON preparado está vazio. Nenhum arquivo foi disponibilizado.');
        const nextUrl = URL.createObjectURL(blob);
        let nextFile;
        try { nextFile = new File([blob], 'SA_Banco_Completo.json', { type: 'application/json' }); }
        catch (_) { nextFile = blob; }
        const dialog = ensureExportDialog();
        const oldUrl = preparedExportUrl;
        preparedExportUrl = nextUrl;
        preparedExportFile = nextFile;
        dialog.download.href = nextUrl;
        dialog.download.download = 'SA_Banco_Completo.json';
        dialog.summary.textContent = `Arquivo preparado: ${formatBytes(blob.size)} • ${summary.athleteCount} atleta(s) • ${summary.recordCount} registro(s) em tabelas • ${summary.fileCount} arquivo(s)/foto(s).`;
        const warnings = [];
        if (!databaseAccessible) warnings.push('Não foi possível acessar o IndexedDB. Confira se todos os dados aparecem no sistema e se as quantidades abaixo correspondem ao esperado.');
        if (!summary.recordCount && !summary.fileCount) warnings.push('Nenhum registro de tabela ou arquivo foi encontrado. Se você esperava dados, não use este JSON como backup.');
        dialog.warning.hidden = warnings.length === 0;
        dialog.warning.textContent = warnings.join(' ');
        dialog.status.textContent = '';
        let canShare = false;
        try { canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [nextFile] }); } catch (_) {}
        dialog.share.hidden = !canShare;
        dialog.saveas.hidden = !(window.isSecureContext && typeof window.showSaveFilePicker === 'function');
        dialog.overlay.style.display = 'flex';
        dialog.download.focus();
        // Não revogar ao clicar ou fechar: o navegador pode ainda estar lendo o Blob.
        // O URL anterior só é liberado quando um novo backup já estiver pronto.
        if (oldUrl) setTimeout(() => URL.revokeObjectURL(oldUrl), 120000);
    }

    async function exportDatabase() {
        if (operationInProgress) return false;
        setBusy(true);
        setStatus('Preparando o JSON completo do banco…', 'working');
        try {
            await waitForAppReady();
            // Aguarda gravações iniciadas antes do clique, sem limpar nem alterar dados.
            if (typeof saveQueue !== 'undefined' && saveQueue && typeof saveQueue.then === 'function') {
                if (await saveQueue === false) throw new Error('A última gravação não foi concluída. Confira os dados no sistema antes de exportar.');
            }
            if (typeof saLocalTableQueues !== 'undefined' && saLocalTableQueues && typeof saLocalTableQueues.values === 'function') {
                await Promise.all(Array.from(saLocalTableQueues.values()));
            }
            const state = await readCurrentState();
            const summary = summarizeState(state);
            // Não ofereça uma cópia visivelmente incompleta se há atletas carregados.
            if (typeof excelData !== 'undefined' && Array.isArray(excelData) && excelData.length > summary.athleteCount) {
                throw new Error('O banco lido tem menos atletas do que a tela atual. O JSON não foi disponibilizado para evitar uma cópia incompleta. Os dados não foram alterados.');
            }
            const tables = Object.create(null);
            Object.entries(state.tables).forEach(([rawName, rows]) => { tables[safeTableName(rawName)] = Array.isArray(rows) ? rows : []; });
            const preferences = Object.create(null);
            Object.entries(state.preferences || {}).forEach(([rawKey, value]) => {
                const key = safeStorageKey(rawKey);
                if (!key.startsWith('db:') && !INTERNAL_STORAGE_KEYS.has(key)) preferences[key] = String(value);
            });
            const files = [];
            for (let index = 0; index < state.files.length; index++) {
                const item = state.files[index];
                const { bucket, path } = safeFileLocation(item.bucket, item.path);
                const blob = item.blob instanceof Blob ? item.blob : new Blob([item.blob || ''], { type: item.contentType || 'application/octet-stream' });
                files.push({ bucket, path, contentType: safeContentType(item.contentType || blob.type), data: await blobToBase64(blob) });
                if (index % 8 === 7) setStatus(`Preparando arquivos/fotos do banco… ${index + 1} de ${state.files.length}`, 'working');
            }
            const payload = { format: DATABASE_FORMAT, formatVersion: DATABASE_FORMAT_VERSION, app: 'VBolonheze Sports — SA local', appVersion: '14', exportedAt: new Date().toISOString(), summary, tables, preferences, files };
            const json = JSON.stringify(payload);
            if (!json || json === '{}') throw new Error('Não foi possível preparar um banco JSON válido.');
            const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
            showPreparedExport(blob, summary, state.databaseAccessible);
            setStatus('JSON preparado. Escolha como salvar e confira o arquivo no dispositivo.', 'success');
            return true;
        } catch (error) {
            console.error('Exportação do banco completo:', error);
            const message = error.message || 'Não foi possível gerar o arquivo JSON completo. Confira o espaço disponível no navegador.';
            setStatus(message, 'error');
            alert(message);
            return false;
        } finally {
            setBusy(false);
        }
    }

    function showExportReminder() {
        const overlay = byId('sa-export-reminder-modal');
        if (!overlay || reminderShown) return;
        reminderShown = true;
        overlay.classList.add('is-open');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.classList.add('sa-export-reminder-open');
        const continueButton = byId('sa-export-reminder-continue');
        if (continueButton) setTimeout(() => continueButton.focus(), 0);
    }

    function closeExportReminder() {
        if (operationInProgress) return;
        const overlay = byId('sa-export-reminder-modal');
        if (overlay) {
            overlay.classList.remove('is-open');
            overlay.setAttribute('aria-hidden', 'true');
        }
        document.body.classList.remove('sa-export-reminder-open');
    }

    function consumeAutoEnter() {
        try {
            if (sessionStorage.getItem(AUTO_ENTER_KEY) !== '1') return null;
            const notice = sessionStorage.getItem(AUTO_NOTICE_KEY) || 'Banco carregado. As alterações serão salvas neste navegador.';
            sessionStorage.removeItem(AUTO_ENTER_KEY);
            sessionStorage.removeItem(AUTO_NOTICE_KEY);
            return notice;
        } catch (_) { return null; }
    }

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || operationInProgress) return;
        const entryOverlay = byId('sa-database-entry-modal');
        const reminderOverlay = byId('sa-export-reminder-modal');
        if (entryOverlay && entryOverlay.classList.contains('is-open')) {
            event.stopPropagation();
            closeOverlay();
        } else if (reminderOverlay && reminderOverlay.classList.contains('is-open')) {
            event.stopPropagation();
            closeExportReminder();
        }
    }, true);

    window.saDatabaseOpenEntry = openDatabaseEntry;
    window.saDatabaseOpenImport = () => openDatabaseEntry('active');
    window.saDatabaseCloseEntry = closeOverlay;
    window.saDatabaseChooseImport = chooseImportFile;
    window.saDatabaseHandleImportFile = handleImportFile;
    window.saDatabaseOpenBrowserCache = openBrowserCache;
    window.saDatabaseStartEmpty = startEmptyDatabase;
    window.saDatabaseExport = exportDatabase;
    window.saDatabaseShowExportReminder = showExportReminder;
    window.saDatabaseCloseExportReminder = closeExportReminder;
    window.saDatabaseSetHomeStatus = setStatus;
    window.saDatabaseConsumeAutoEnter = consumeAutoEnter;
})();
