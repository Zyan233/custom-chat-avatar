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

let currentTarget = 'user';
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
        ctx.extensionSettings[EXTENSION_NAME] = { avatars: {} };
    }
    return ctx.extensionSettings[EXTENSION_NAME];
}

function getAvatarMeta(target) {
    const settings = initSettings();
    return settings.avatars[target] || null;
}

function saveAvatarMeta(target, meta) {
    const settings = initSettings();
    settings.avatars[target] = meta;
    getCtx().saveSettingsDebounced();
}

function deleteAvatarMeta(target) {
    const settings = initSettings();
    delete settings.avatars[target];
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
// UI
// ============================================

function updatePreview() {
    const meta = getAvatarMeta(currentTarget);
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
    const meta = getAvatarMeta(currentTarget);
    if (!meta) return;

    const scale = parseInt(document.getElementById('custom_avatar_scale').value);
    const x = parseInt(document.getElementById('custom_avatar_x').value);
    const y = parseInt(document.getElementById('custom_avatar_y').value);

    meta.position = { x, y, scale };
    saveAvatarMeta(currentTarget, meta);

    const previewImg = document.getElementById('custom_avatar_preview_img');
    if (previewImg) {
        previewImg.style.transform = `translate(${x}%, ${y}%) scale(${scale / 100})`;
    }

    document.getElementById('custom_avatar_scale_value').textContent = `${scale}%`;
    document.getElementById('custom_avatar_x_value').textContent = `${x}%`;
    document.getElementById('custom_avatar_y_value').textContent = `${y}%`;

    applyAllAvatars();
}

function populateTargetSelect() {
    const select = document.getElementById('custom_avatar_target');
    if (!select) return;

    const ctx = getCtx();
    select.innerHTML = '<option value="user">用户 (我)</option>';

    if (ctx.characters) {
        const addedNames = new Set();
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
                if (char && char.name) {
                    const exists = Array.from(select.options).some(o => o.value === char.name);
                    if (!exists) {
                        const option = document.createElement('option');
                        option.value = char.name;
                        option.textContent = char.name;
                        select.appendChild(option);
                    }
                }
            });
        }
    }

    select.value = currentTarget;
}

// ============================================
// 头像替换
// ============================================

function applyAvatarToMessage(mesElement) {
    if (!mesElement) return;

    const isUser = mesElement.getAttribute('is_user') === 'true';
    const charName = mesElement.getAttribute('ch_name');
    const target = isUser ? 'user' : charName;

    if (!target) return;

    const meta = getAvatarMeta(target);
    const avatarContainer = mesElement.querySelector('.avatar');
    const avatarImg = avatarContainer ? avatarContainer.querySelector('img') : null;

    if (!avatarContainer || !avatarImg) return;

    if (meta && meta.data) {
        avatarImg.src = meta.data;
        avatarContainer.classList.add('custom-avatar-active');

        const pos = meta.position || { x: 0, y: 0, scale: 100 };
        avatarImg.style.objectPosition = `${50 + pos.x}% ${50 + pos.y}%`;
        avatarImg.style.transform = `scale(${pos.scale / 100})`;
        avatarImg.style.objectFit = 'cover';
    } else {
        avatarContainer.classList.remove('custom-avatar-active');
        avatarImg.style.objectPosition = '';
        avatarImg.style.transform = '';
        avatarImg.style.objectFit = '';
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

function bindSettingsEvents() {
    const targetSelect = document.getElementById('custom_avatar_target');
    if (targetSelect) {
        targetSelect.addEventListener('change', (e) => {
            currentTarget = e.target.value;
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
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                toastr.error('请选择图片文件');
                return;
            }

            try {
                toastr.info('正在处理图片...');
                const dataUrl = await processImage(file, currentRatio);

                const meta = {
                    data: dataUrl,
                    ratio: currentRatio,
                    position: { x: 0, y: 0, scale: 100 },
                };
                saveAvatarMeta(currentTarget, meta);
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
            deleteAvatarMeta(currentTarget);
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
            const meta = getAvatarMeta(currentTarget);
            if (!meta) return;

            meta.position = { x: 0, y: 0, scale: 100 };
            saveAvatarMeta(currentTarget, meta);

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
    populateTargetSelect();
    updatePreview();

    // 监听事件
    const { eventSource, event_types } = ctx;

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onMessageRendered);

    eventSource.on(event_types.CHAT_CHANGED, () => {
        populateTargetSelect();
        updatePreview();
        setTimeout(applyAllAvatars, 300);
    });

    setTimeout(applyAllAvatars, 500);

    console.log(`[${EXTENSION_NAME}] Extension loaded.`);
});
