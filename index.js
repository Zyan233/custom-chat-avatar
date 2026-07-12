// Custom Chat Avatar - SillyTavern Extension
// 为角色和用户自定义聊天区域头像，支持多种比例、高清图片和位置调整
// 图片以 base64 存储在 extension_settings 中（服务端 settings.json，非浏览器 localStorage）

const EXTENSION_NAME = 'custom-chat-avatar';
const EXTENSION_FOLDER = `third-party/${EXTENSION_NAME}`;
const MAX_DIMENSION = 960;
const JPEG_QUALITY = 0.92;

const RATIO_MAP = {
    '1:1': { w: 1, h: 1 },
    '3:4': { w: 3, h: 4 },
    '4:3': { w: 4, h: 3 },
    '16:9': { w: 16, h: 9 },
    '9:16': { w: 9, h: 16 },
    '3:2': { w: 3, h: 2 },
};

let currentTab = 'user'; // 'user' | 'char'
let currentUserTarget = ''; // persona avatar ID
let currentCharTarget = ''; // character name
let currentRatio = '16:9';

// ============================================
// 存储层 - 全部存在 extension_settings（服务端文件）
// ============================================

function getCtx() {
    return SillyTavern.getContext();
}

function initSettings() {
    const ctx = getCtx();
    if (!ctx.extensionSettings[EXTENSION_NAME]) {
        ctx.extensionSettings[EXTENSION_NAME] = { avatars: { user: {}, char: {} } };
    }
    const settings = ctx.extensionSettings[EXTENSION_NAME];
    if (!settings.avatars.user) settings.avatars.user = {};
    if (!settings.avatars.char) settings.avatars.char = {};
    return settings;
}

function getAvatarMeta(targetType, targetKey) {
    const settings = initSettings();
    return settings.avatars[targetType]?.[targetKey] || null;
}

function saveAvatarMeta(targetType, targetKey, meta) {
    const settings = initSettings();
    settings.avatars[targetType][targetKey] = meta;
    getCtx().saveSettingsDebounced();
}

function deleteAvatarMeta(targetType, targetKey) {
    const settings = initSettings();
    delete settings.avatars[targetType][targetKey];
    getCtx().saveSettingsDebounced();
}

// ============================================
// 图片处理
// ============================================

function calculateDimensions(ratio) {
    const { w, h } = RATIO_MAP[ratio];
    if (w >= h) {
        return { width: MAX_DIMENSION, height: Math.round(MAX_DIMENSION * h / w) };
    } else {
        return { width: Math.round(MAX_DIMENSION * w / h), height: MAX_DIMENSION };
    }
}

function processImage(file, ratio) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);

            const { width: targetW, height: targetH } = calculateDimensions(ratio);
            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');

            const targetRatio = targetW / targetH;
            const srcRatio = img.width / img.height;
            let sx, sy, sw, sh;

            if (srcRatio > targetRatio) {
                sh = img.height;
                sw = img.height * targetRatio;
                sx = (img.width - sw) / 2;
                sy = 0;
            } else {
                sw = img.width;
                sh = img.width / targetRatio;
                sx = 0;
                sy = (img.height - sh) / 2;
            }

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);

            // 直接输出 dataURL，存入 extension_settings（服务端文件，不受浏览器限制）
            const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
            resolve(dataUrl);
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('图片加载失败'));
        };
        img.src = objectUrl;
    });
}

// ============================================
// Persona 工具
// ============================================

function getActivePersonaId() {
    const ctx = getCtx();
    const personas = ctx.powerUserSettings?.personas || {};
    const entry = Object.entries(personas).find(([_, name]) => name === ctx.name1);
    return entry ? entry[0] : null;
}

function getPersonaList() {
    const ctx = getCtx();
    return Object.entries(ctx.powerUserSettings?.personas || {})
        .map(([avatarId, name]) => ({ avatarId, name }));
}

// ============================================
// UI
// ============================================

function getCurrentTargetKey() {
    return currentTab === 'user' ? currentUserTarget : currentCharTarget;
}

function updatePreview() {
    const targetKey = getCurrentTargetKey();
    const meta = getAvatarMeta(currentTab, targetKey);
    const previewWrapper = document.getElementById('custom_avatar_preview_wrapper');
    const previewImg = document.getElementById('custom_avatar_preview_img');
    const noImage = document.getElementById('custom_avatar_no_image');
    const posControls = document.getElementById('custom_avatar_position_controls');

    if (!previewWrapper || !previewImg || !noImage || !posControls) return;

    if (meta && meta.data) {
        previewWrapper.classList.add('active');
        noImage.classList.add('hidden');
        posControls.style.display = '';

        previewImg.src = meta.data;

        const ratio = meta.ratio || '16:9';
        const { w, h } = RATIO_MAP[ratio];
        previewWrapper.style.paddingBottom = `${(h / w) * 100}%`;
        previewWrapper.style.height = '0';

        const pos = meta.position || { x: 0, y: 0, scale: 100 };
        previewImg.style.transform = `translate(${pos.x}%, ${pos.y}%) scale(${pos.scale / 100})`;
        previewImg.style.position = 'absolute';
        previewImg.style.top = '0';
        previewImg.style.left = '0';

        document.getElementById('custom_avatar_scale').value = pos.scale;
        document.getElementById('custom_avatar_scale_value').textContent = `${pos.scale}%`;
        document.getElementById('custom_avatar_x').value = pos.x;
        document.getElementById('custom_avatar_x_value').textContent = `${pos.x}%`;
        document.getElementById('custom_avatar_y').value = pos.y;
        document.getElementById('custom_avatar_y_value').textContent = `${pos.y}%`;

        document.getElementById('custom_avatar_ratio').value = ratio;
        currentRatio = ratio;
    } else {
        previewWrapper.classList.remove('active');
        noImage.classList.remove('hidden');
        posControls.style.display = 'none';
        previewWrapper.style.paddingBottom = '';
        previewWrapper.style.height = '';
    }
}

function updatePosition() {
    const targetKey = getCurrentTargetKey();
    if (!targetKey) return;
    const meta = getAvatarMeta(currentTab, targetKey);
    if (!meta) return;

    const scale = parseInt(document.getElementById('custom_avatar_scale').value);
    const x = parseInt(document.getElementById('custom_avatar_x').value);
    const y = parseInt(document.getElementById('custom_avatar_y').value);

    meta.position = { x, y, scale };
    saveAvatarMeta(currentTab, targetKey, meta);

    const previewImg = document.getElementById('custom_avatar_preview_img');
    if (previewImg) {
        previewImg.style.transform = `translate(${x}%, ${y}%) scale(${scale / 100})`;
    }

    document.getElementById('custom_avatar_scale_value').textContent = `${scale}%`;
    document.getElementById('custom_avatar_x_value').textContent = `${x}%`;
    document.getElementById('custom_avatar_y_value').textContent = `${y}%`;

    applyAllAvatars();
}

function populatePersonaSelect() {
    const select = document.getElementById('custom_avatar_target');
    if (!select) return;

    const list = getPersonaList();
    const activeId = getActivePersonaId();

    select.innerHTML = '';

    if (list.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '（请先在 SillyTavern 中创建 persona）';
        option.disabled = true;
        select.appendChild(option);
        select.disabled = true;
        currentUserTarget = '';
        return;
    }

    select.disabled = false;
    list.forEach(({ avatarId, name }) => {
        const option = document.createElement('option');
        option.value = avatarId;
        option.textContent = `${name}`;
        select.appendChild(option);
    });

    // 默认选中活跃 persona；若已选中项不在列表里则回退到活跃
    const stillExists = list.some(p => p.avatarId === currentUserTarget);
    if (!stillExists) currentUserTarget = activeId || list[0].avatarId;
    select.value = currentUserTarget;
}

function populateCharSelect() {
    const select = document.getElementById('custom_avatar_target');
    if (!select) return;

    const ctx = getCtx();
    select.innerHTML = '';

    const addedNames = new Set();
    if (ctx.characters) {
        ctx.characters.forEach(char => {
            if (char.name && !addedNames.has(char.name)) {
                addedNames.add(char.name);
                const option = document.createElement('option');
                option.value = char.name;
                option.textContent = char.name;
                select.appendChild(option);
            }
        });
    }

    if (ctx.groups && ctx.groupId) {
        const currentGroup = ctx.groups.find(g => g.id === ctx.groupId);
        if (currentGroup && currentGroup.members) {
            currentGroup.members.forEach(memberId => {
                const char = ctx.characters.find(c => c.avatar === memberId);
                if (char && char.name && !addedNames.has(char.name)) {
                    addedNames.add(char.name);
                    const option = document.createElement('option');
                    option.value = char.name;
                    option.textContent = char.name;
                    select.appendChild(option);
                }
            });
        }
    }

    if (select.options.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '（暂无角色）';
        option.disabled = true;
        select.appendChild(option);
        select.disabled = true;
        currentCharTarget = '';
        return;
    }

    select.disabled = false;
    const stillExists = Array.from(select.options).some(o => o.value === currentCharTarget);
    if (!stillExists) currentCharTarget = select.options[0].value;
    select.value = currentCharTarget;
}

function populateActiveSelect() {
    if (currentTab === 'user') populatePersonaSelect();
    else populateCharSelect();
}

// ============================================
// 头像替换
// ============================================

// 缓存每个 avatarImg 的原始 src，在删除自定义头像时还原
function getOriginalSrc(img) {
    return img.dataset.customAvatarOriginal || null;
}

function setOriginalSrc(img, src) {
    if (src) img.dataset.customAvatarOriginal = src;
}

function applyAvatarToMessage(mesElement) {
    if (!mesElement) return;

    const isUser = mesElement.getAttribute('is_user') === 'true';
    const charName = mesElement.getAttribute('ch_name');

    const avatarContainer = mesElement.querySelector('.avatar');
    const avatarImg = avatarContainer ? avatarContainer.querySelector('img') : null;

    if (!avatarContainer || !avatarImg) return;

    let meta = null;
    if (isUser) {
        const personaId = getActivePersonaId();
        if (personaId) meta = getAvatarMeta('user', personaId);
    } else {
        if (charName) meta = getAvatarMeta('char', charName);
    }

    if (meta && meta.data) {
        // 首次应用自定义头像时，缓存原始 src
        if (!avatarContainer.classList.contains('custom-avatar-active')) {
            setOriginalSrc(avatarImg, avatarImg.src);
        }
        avatarImg.src = meta.data;
        avatarContainer.classList.add('custom-avatar-active');

        const pos = meta.position || { x: 0, y: 0, scale: 100 };
        avatarImg.style.transform = `translate(${pos.x}%, ${pos.y}%) scale(${pos.scale / 100})`;
        avatarImg.style.objectFit = 'cover';
        avatarImg.style.objectPosition = '';
    } else {
        avatarContainer.classList.remove('custom-avatar-active');
        avatarImg.style.objectPosition = '';
        avatarImg.style.transform = '';
        avatarImg.style.objectFit = '';
        // 仅在之前应用过自定义头像时才还原 src（避免覆盖尚未缓存的原始值）
        const original = getOriginalSrc(avatarImg);
        if (original) {
            avatarImg.src = original;
        }
    }
}

function applyAllAvatars() {
    const messages = document.querySelectorAll('#chat .mes');
    messages.forEach(mes => applyAvatarToMessage(mes));
}

function onMessageRendered(mesId) {
    const mesElement = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
    applyAvatarToMessage(mesElement);
}

// ============================================
// 事件绑定
// ============================================

function switchTab(tab) {
    if (tab !== 'user' && tab !== 'char') return;
    if (currentTab === tab) return;
    currentTab = tab;

    document.querySelectorAll('.custom-avatar-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    populateActiveSelect();
    updatePreview();
}

function bindSettingsEvents() {
    document.querySelectorAll('.custom-avatar-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    const targetSelect = document.getElementById('custom_avatar_target');
    if (targetSelect) {
        targetSelect.addEventListener('change', (e) => {
            if (currentTab === 'user') currentUserTarget = e.target.value;
            else currentCharTarget = e.target.value;
            updatePreview();
        });
    }

    const ratioSelect = document.getElementById('custom_avatar_ratio');
    if (ratioSelect) {
        ratioSelect.addEventListener('change', (e) => {
            currentRatio = e.target.value;
        });
    }

    const uploadBtn = document.getElementById('custom_avatar_upload_btn');
    const fileInput = document.getElementById('custom_avatar_file');
    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => {
            if (!getCurrentTargetKey()) {
                toastr.warning('请先选择一个' + (currentTab === 'user' ? ' persona' : '角色'));
                return;
            }
            fileInput.click();
        });
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                toastr.error('请选择图片文件');
                return;
            }

            const targetKey = getCurrentTargetKey();
            if (!targetKey) return;

            try {
                toastr.info('正在处理图片...');
                const dataUrl = await processImage(file, currentRatio);

                const meta = {
                    data: dataUrl,
                    ratio: currentRatio,
                    position: { x: 0, y: 0, scale: 100 },
                };
                saveAvatarMeta(currentTab, targetKey, meta);
                updatePreview();
                applyAllAvatars();
                toastr.success('头像已更新');
            } catch (err) {
                console.error(`[${EXTENSION_NAME}]`, err);
                toastr.error('图片处理失败: ' + err.message);
            }

            fileInput.value = '';
        });
    }

    const deleteBtn = document.getElementById('custom_avatar_delete_btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            const targetKey = getCurrentTargetKey();
            if (!targetKey) return;
            deleteAvatarMeta(currentTab, targetKey);
            updatePreview();
            applyAllAvatars();
            toastr.success('已恢复默认头像');
        });
    }

    const scaleSlider = document.getElementById('custom_avatar_scale');
    const xSlider = document.getElementById('custom_avatar_x');
    const ySlider = document.getElementById('custom_avatar_y');

    if (scaleSlider) scaleSlider.addEventListener('input', updatePosition);
    if (xSlider) xSlider.addEventListener('input', updatePosition);
    if (ySlider) ySlider.addEventListener('input', updatePosition);

    const resetPosBtn = document.getElementById('custom_avatar_reset_pos_btn');
    if (resetPosBtn) {
        resetPosBtn.addEventListener('click', () => {
            const targetKey = getCurrentTargetKey();
            if (!targetKey) return;
            const meta = getAvatarMeta(currentTab, targetKey);
            if (!meta) return;

            meta.position = { x: 0, y: 0, scale: 100 };
            saveAvatarMeta(currentTab, targetKey, meta);

            document.getElementById('custom_avatar_scale').value = 100;
            document.getElementById('custom_avatar_x').value = 0;
            document.getElementById('custom_avatar_y').value = 0;

            updatePreview();
            applyAllAvatars();
        });
    }
}

// ============================================
// 初始化
// ============================================

jQuery(async () => {
    const ctx = getCtx();

    initSettings();

    // 加载设置面板
    const { renderExtensionTemplateAsync } = ctx;
    const settingsHtml = await renderExtensionTemplateAsync(EXTENSION_FOLDER, 'settings');
    $('#extensions_settings2').append(settingsHtml);

    bindSettingsEvents();
    document.querySelector('.custom-avatar-tab[data-tab="user"]')?.classList.add('active');
    populateActiveSelect();
    updatePreview();

    // 监听事件
    const { eventSource, event_types } = ctx;

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onMessageRendered);

    eventSource.on(event_types.CHAT_CHANGED, () => {
        populateActiveSelect();
        updatePreview();
        setTimeout(applyAllAvatars, 300);
    });

    if (event_types.PERSONA_CHANGED) {
        eventSource.on(event_types.PERSONA_CHANGED, () => {
            if (currentTab === 'user') {
                populatePersonaSelect();
                updatePreview();
            }
            applyAllAvatars();
        });
    }

    setTimeout(applyAllAvatars, 500);

    console.log(`[${EXTENSION_NAME}] Extension loaded.`);
});
