const fs = require('fs');
const path = require('path');
const os = require('os');

// 获取当前时间戳
const now = new Date();
const timestamp = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') + '_' +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');

// 日期字符串（用于文件夹命名）
const dateStr = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0');
const skipCsvOutput = ['1', 'true', 'yes'].includes(String(process.env.SKIP_CSV_OUTPUT || '').toLowerCase());

// =====================================================
// 路径配置
// =====================================================
// 脚本位于 .claude/skills/筛选简历/scripts/ 下；实际筛选时以命令执行目录作为项目根目录。
// 这样既能把脚本收纳在 skill 目录中，又能继续读取项目根目录下的 简历/、岗位.md 等业务文件。
const PROJECT_ROOT = process.cwd();
const SKILL_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = fs.existsSync(path.join(PROJECT_ROOT, 'skills_config.json'))
    ? path.join(PROJECT_ROOT, 'skills_config.json')
    : path.join(SKILL_ROOT, 'templates', 'skills_config.json');

// =====================================================
// 加载技能筛选配置
// =====================================================
let skillsConfig = {};
try {
    skillsConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    console.log('✅ 已加载技能筛选配置:', CONFIG_PATH);
} catch (e) {
    console.log('⚠️  未找到 skills_config.json，使用默认配置');
    skillsConfig = {
        scoring: { weights: { skillWeight: 0.40, expWeight: 0.35, eduWeight: 0.25 }, autoCalcTotal: true },
        classification: { 合格阈值: 60, 推荐等级: ['强烈推荐', '推荐', '需面试确认'], 合格文件夹名: '合格简历', 不合格文件夹名: '不合格简历', 文件夹含日期: true, 日期格式: 'YYYYMMDD' },
        skills: {}
    };
}

const scoringWeights = skillsConfig.scoring.weights;
const classCfg = skillsConfig.classification;
const candidateSchools = skillsConfig.candidateSchools || {};
const talentPoolCfg = Object.assign({
    enabled: true,
    profile: 'lmt-hire',
    pageSize: 20,
    timeoutMs: 20000
}, skillsConfig.talentPool || {});
const talentPoolProfile = process.env.LARK_CLI_PROFILE || talentPoolCfg.profile || 'lmt-hire';
const talentPoolMock = loadTalentPoolMock();

const FALLBACK_985_SCHOOLS = [
    '北京大学', '中国人民大学', '清华大学', '北京航空航天大学', '北京理工大学', '中国农业大学', '北京师范大学', '中央民族大学',
    '南开大学', '天津大学', '大连理工大学', '东北大学', '吉林大学', '哈尔滨工业大学', '复旦大学', '同济大学',
    '上海交通大学', '华东师范大学', '南京大学', '东南大学', '浙江大学', '中国科学技术大学', '厦门大学', '山东大学',
    '中国海洋大学', '武汉大学', '华中科技大学', '湖南大学', '中南大学', '中山大学', '华南理工大学', '四川大学',
    '重庆大学', '电子科技大学', '西安交通大学', '西北工业大学', '西北农林科技大学', '兰州大学', '国防科技大学'
];
const FALLBACK_211_SCHOOLS = [
    ...FALLBACK_985_SCHOOLS,
    '北京交通大学', '北京工业大学', '北京科技大学', '北京化工大学', '北京邮电大学', '北京林业大学', '北京中医药大学',
    '北京外国语大学', '中国传媒大学', '中央财经大学', '对外经济贸易大学', '北京体育大学', '中央音乐学院', '中国政法大学',
    '华北电力大学', '中国矿业大学（北京）', '中国石油大学（北京）', '中国地质大学（北京）', '天津医科大学', '河北工业大学',
    '太原理工大学', '内蒙古大学', '辽宁大学', '大连海事大学', '延边大学', '东北师范大学', '哈尔滨工程大学', '东北农业大学',
    '东北林业大学', '华东理工大学', '东华大学', '上海外国语大学', '上海财经大学', '上海大学', '苏州大学', '南京航空航天大学',
    '南京理工大学', '中国矿业大学', '河海大学', '江南大学', '南京农业大学', '中国药科大学', '南京师范大学', '安徽大学',
    '合肥工业大学', '福州大学', '南昌大学', '中国石油大学（华东）', '郑州大学', '武汉理工大学', '华中农业大学', '华中师范大学',
    '中南财经政法大学', '湖南师范大学', '暨南大学', '华南师范大学', '海南大学', '广西大学', '西南交通大学', '四川农业大学',
    '西南大学', '西南财经大学', '贵州大学', '云南大学', '西藏大学', '西北大学', '西安电子科技大学', '长安大学',
    '陕西师范大学', '青海大学', '宁夏大学', '新疆大学', '石河子大学', '第二军医大学', '第四军医大学'
];
const TOP_SCHOOL_KEYWORDS = ['985', 'C9'];
const HIGH_SCHOOL_KEYWORDS = ['211', '双一流', '一流大学', '一流学科'];
const collegeRankings = loadCollegeRankings();

function normalizeSchoolName(schoolName) {
    return String(schoolName || '')
        .replace(/[（）]/g, m => m === '（' ? '(' : ')')
        .replace(/\s+/g, '')
        .trim();
}

function schoolNameMatches(schoolName, schoolSet) {
    const normalized = normalizeSchoolName(schoolName);
    if (!normalized) return false;
    for (const school of schoolSet) {
        const target = normalizeSchoolName(school);
        if (target && (normalized === target || normalized.includes(target) || target.includes(normalized))) return true;
    }
    return false;
}

function loadCollegeRankings() {
    const result = { all: new Set(), schools985: new Set(FALLBACK_985_SCHOOLS), schools211: new Set(FALLBACK_211_SCHOOLS) };
    const listPath = path.join(PROJECT_ROOT, '院校名单.xls');
    if (!fs.existsSync(listPath)) return result;

    try {
        const XLSX = require('xlsx');
        const workbook = XLSX.readFile(listPath);
        workbook.SheetNames.forEach(sheetName => {
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' });
            rows.forEach(row => {
                const cells = row.map(v => String(v || '').trim()).filter(Boolean);
                const rowText = cells.join(' ');
                cells.forEach(cell => {
                    const matches = cell.match(/[一-龥]{2,}(?:大学|学院)/g) || [];
                    matches.forEach(name => result.all.add(normalizeSchoolName(name)));
                });
                const schoolName = cells.find(cell => /^[一-龥]{2,}(?:大学|学院)$/.test(cell));
                if (!schoolName) return;
                if (/(^|[^0-9])985([^0-9]|$)/.test(rowText)) result.schools985.add(schoolName);
                if (/(^|[^0-9])211([^0-9]|$)|双一流|一流大学|一流学科/.test(rowText)) result.schools211.add(schoolName);
            });
        });
    } catch (e) {
        console.log(`⚠️  院校名单读取失败，使用内置 985/211 名单：${e.message}`);
    }

    // 院校名单.xls 当前主要是全国普通高校清单，未必包含 985/211 标记；内置名单用于补足分层信息。
    result.schools985.forEach(name => result.schools211.add(name));
    return result;
}

function getSchoolLevel(schoolName) {
    if (!schoolName || schoolName === '无学校信息' || schoolName === '未知') return '未识别';
    if (TOP_SCHOOL_KEYWORDS.some(k => schoolName.includes(k)) || schoolNameMatches(schoolName, collegeRankings.schools985)) return '985院校';
    if (schoolName.includes('211') || schoolNameMatches(schoolName, collegeRankings.schools211)) return '211院校';
    if (HIGH_SCHOOL_KEYWORDS.some(k => schoolName.includes(k))) return '双一流院校';
    if (/(大学|学院)/.test(schoolName) || schoolNameMatches(schoolName, collegeRankings.all)) return '普通院校';
    return '未识别';
}

function getSchoolBonus(schoolName) {
    const level = getSchoolLevel(schoolName);
    if (level === '985院校') return 12;
    if (level === '211院校') return 8;
    if (level === '双一流院校') return 6;
    if (level === '普通院校') return 2;
    return 0;
}

/**
 * 第一学历校验
 * @param {string} candidateName 候选人姓名
 * @param {string} positionName 岗位名称（用于获取岗位要求的最低学历层次）
 * @returns {{ pass: boolean, schoolName: string, schoolLevel: string, minLevel: string, reason: string }}
 */
function checkEducation(candidateName, positionName, pdfSchoolHint) {
    const schoolName = (candidateSchools[candidateName] || '').trim();

    if (!schoolName || schoolName === '无学校信息') {
        let reason = !schoolName
            ? `未配置 ${candidateName} 的学校信息`
            : `${candidateName} 的简历中未找到学校信息`;
        if (pdfSchoolHint) {
            reason += `（PDF中检测到学校线索：${pdfSchoolHint}，可更新 skills_config.json 确认）`;
        }
        return {
            pass: true,
            schoolName: pdfSchoolHint || schoolName || '未知',
            schoolLevel: '未识别',
            minLevel: '未要求',
            reason
        };
    }

    return {
        pass: true,
        schoolName,
        schoolLevel: '已记录',
        minLevel: '未要求',
        reason: `学校"${schoolName}"已记录`
    };
}

// =====================================================
// PDF 文本提取与清洗（调用 pdftotext）
// =====================================================

/**
 * 调用 pdftotext 从 PDF 中提取原始文本
 * @param {string} filePath PDF文件绝对路径
 * @returns {string} 提取的文本
 */
function extractPdfText(filePath) {
    const { execFileSync } = require('child_process');
    const pdftotextCmd = resolveCommand('pdftotext', [
        'C:/Users/Ye.Chen/AppData/Local/Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin/pdftotext.exe'
    ]);
    if (!pdftotextCmd) return '';
    try {
        const out = execFileSync(pdftotextCmd, ['-raw', filePath, '-'], {
            encoding: 'utf8',
            maxBuffer: 2 * 1024 * 1024,
            timeout: 10000,
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return out || '';
    } catch (e) {
        return '';
    }
}

function resolveCommand(command, fallbackPaths = []) {
    // 优先使用已知的绝对路径，避免 execSync 的 shell 编码问题
    for (const p of fallbackPaths) {
        if (fs.existsSync(p)) return p;
    }
    const { execFileSync } = require('child_process');
    try {
        execFileSync(command, ['--version'], { stdio: 'ignore', timeout: 5000 });
        return command;
    } catch (e) { /* ignore */ }
    return '';
}

function loadTalentPoolMock() {
    const raw = process.env.TALENT_POOL_MOCK_JSON || '';
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (e) {
        console.log(`⚠️  TALENT_POOL_MOCK_JSON 解析失败: ${e.message}`);
        return null;
    }
}

function safeJsonParse(raw) {
    try { return JSON.parse(raw); } catch (e) { return null; }
}

function getNested(obj, pathList, fallback) {
    let cur = obj;
    for (const key of pathList) {
        if (cur === undefined || cur === null) return fallback;
        cur = cur[key];
    }
    return cur === undefined || cur === null ? fallback : cur;
}

function larkApi(method, apiPath, options = {}) {
    const { execSync } = require('child_process');
    let stdinData = '';
    let paramsStr = '';
    if (options.data) stdinData = JSON.stringify(options.data);
    if (options.params) paramsStr = JSON.stringify(options.params);
    let cmd = `lark-cli api ${method} ${apiPath} --as bot --profile ${talentPoolProfile} --format json`;
    if (stdinData) cmd += ' --data -';
    if (paramsStr) cmd += ' --params -';
    let input = '';
    if (paramsStr) input += paramsStr + '\n';
    if (stdinData) input += stdinData + '\n';
    try {
        const out = execSync(cmd, {
            encoding: 'utf8',
            input: input || undefined,
            maxBuffer: 5 * 1024 * 1024,
            timeout: talentPoolCfg.timeoutMs || 20000,
            shell: true,
            env: Object.assign({}, process.env, { MSYS_NO_PATHCONV: '1' }),
            stdio: ['pipe', 'pipe', 'pipe']
        });
        return safeJsonParse(out) || {};
    } catch (e) {
        const body = (e.stdout || e.stderr || e.message || '').toString();
        const parsed = safeJsonParse(body);
        if (parsed) return parsed;
        throw new Error(
            safeJsonParse(e.stderr)
                ? getNested(safeJsonParse(e.stderr), ['error', 'message'], 'API 请求失败')
                : (e.message || 'API 请求失败').split('\n')[0]
        );
    }
}

function extractContactsFromText(text) {
    const cleaned = text || '';
    const emails = [...new Set((cleaned.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
        .filter(e => !/^[a-f0-9]{8,}@/i.test(e)))];
    const phones = [];
    const phoneMatches = cleaned.match(/(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}/g) || [];
    phoneMatches.forEach(p => {
        const digits = p.replace(/\D/g, '').replace(/^86(?=1\d{10}$)/, '');
        if (/^1[3-9]\d{9}$/.test(digits) && !phones.includes(digits)) phones.push(digits);
    });
    return { emails, phones };
}

function extractContactsFromPdf(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return { emails: [], phones: [] };
    const raw = extractResumeText(filePath);
    return extractContactsFromText(raw);
}

function normalizeTalentIdResponse(resp) {
    const data = resp.data || resp;
    const listCandidates = [
        data.talent_id_list,
        data.talent_ids,
        data.items,
        data.results,
        data.talents,
        data.email_result_list,
        data.mobile_result_list
    ].filter(Array.isArray);
    for (const list of listCandidates) {
        for (const item of list) {
            if (typeof item === 'string') return item;
            if (item && (item.talent_id || item.id)) return item.talent_id || item.id;
        }
    }
    if (data.talent_id) return data.talent_id;
    if (data.id) return data.id;
    return '';
}

function getTalentIdByContact(contacts) {
    if ((contacts.emails || []).length > 0) {
        const resp = larkApi('POST', '/open-apis/hire/v1/talents/batch_get_id', {
            data: { email_list: contacts.emails }
        });
        const talentId = normalizeTalentIdResponse(resp);
        if (talentId) return { talentId, method: `邮箱 ${contacts.emails[0]}` };
    }
    if ((contacts.phones || []).length > 0) {
        const resp = larkApi('POST', '/open-apis/hire/v1/talents/batch_get_id', {
            data: { mobile_code: '86', mobile_number_list: contacts.phones }
        });
        const talentId = normalizeTalentIdResponse(resp);
        if (talentId) return { talentId, method: `手机 ${contacts.phones[0]}` };
    }
    return { talentId: '', method: '' };
}

function normalizeApplications(resp) {
    const data = resp.data || resp;
    const items = data.items || data.applications || data.application_list || data.list || [];
    return Array.isArray(items) ? items : [];
}

function formatApplicationDetail(app, detailResp) {
    const data = detailResp && (detailResp.data || detailResp) || {};
    const detail = data.application || data.item || data || app || {};
    const job = detail.job || detail.recruitment || {};
    const stage = detail.stage || detail.process || {};
    const jobId = detail.job_id || job.id || getNested(detail, ['job', 'job_id'], '') || '';
    const jobName = detail.job_name || job.title || job.name || '';
    const stageName = detail.stage_name || stage.name || detail.process_name || '';
    const activeStatus = detail.active_status || detail.status || '';
    const deliveryType = detail.delivery_type || detail.source || detail.channel || '';
    const applyTime = detail.apply_time || detail.delivery_time || detail.create_time || detail.created_time || '';
    return {
        applicationId: detail.application_id || detail.id || app.application_id || app.id || '',
        jobId,
        jobName,
        stageName,
        activeStatus,
        deliveryType,
        applyTime
    };
}

function queryTalentPoolByLark(contacts) {
    try {
        const idResult = getTalentIdByContact(contacts);
        if (!idResult.talentId) {
            return { status: 'not_found', inPool: false, talentId: '', queryMethod: idResult.method || '联系方式', applications: [], message: '人才库未查询到该候选人' };
        }

        const listResp = larkApi('GET', '/open-apis/hire/v1/applications', {
            params: { talent_id: idResult.talentId, page_size: talentPoolCfg.pageSize || 20 }
        });
        const apps = normalizeApplications(listResp);
        const details = apps.map(app => {
            const appId = app.application_id || app.id;
            if (!appId) return formatApplicationDetail(app, null);
            try {
                const detailResp = larkApi('GET', `/open-apis/hire/v1/applications/${appId}`);
                return formatApplicationDetail(app, detailResp);
            } catch (e) {
                return formatApplicationDetail(app, null);
            }
        });

        return {
            status: 'found',
            inPool: true,
            talentId: idResult.talentId,
            queryMethod: idResult.method,
            applications: details,
            message: details.length > 0 ? `已进入人才库，存在 ${details.length} 条投递记录` : '已进入人才库，暂无投递详情'
        };
    } catch (e) {
        return { status: 'error', inPool: false, talentId: '', queryMethod: 'lark-cli', applications: [], message: `人才库查询失败：${e.message}` };
    }
}

function queryTalentPoolMock(candidate) {
    if (!talentPoolMock) return null;
    const byName = talentPoolMock[candidate.name] || (talentPoolMock.candidates && talentPoolMock.candidates[candidate.name]);
    if (!byName) return null;
    if (byName === true) {
        return { status: 'found', inPool: true, talentId: `mock-${candidate.name}`, queryMethod: '测试模拟', applications: [], message: '测试模拟：已进入人才库' };
    }
    return Object.assign({ status: byName.inPool ? 'found' : 'not_found', applications: [] }, byName);
}

function checkTalentPool(candidate) {
    const mock = queryTalentPoolMock(candidate);
    if (mock) return mock;
    if (!talentPoolCfg.enabled) {
        return { status: 'disabled', inPool: false, talentId: '', queryMethod: '', applications: [], message: '人才库查询未启用' };
    }
    const contacts = extractContactsFromPdf(candidate.filePath);
    candidate.contacts = contacts;
    if (contacts.emails.length === 0 && contacts.phones.length === 0) {
        return { status: 'no_contact', inPool: false, talentId: '', queryMethod: '', applications: [], message: '简历中未提取到邮箱或手机号，无法查询人才库' };
    }
    try {
        return queryTalentPoolByLark(contacts);
    } catch (e) {
        return { status: 'error', inPool: false, talentId: '', queryMethod: '', applications: [], message: `人才库查询失败：${e.message}` };
    }
}

function getApplicationSummary(c) {
    const tp = c.talentPool || {};
    if (!tp.inPool) return tp.message || '未进入人才库';
    const apps = tp.applications || [];
    if (apps.length === 0) return tp.message || '已进入人才库';
    return apps.map(a => {
        const parts = [];
        if (a.jobName || a.jobId) parts.push(a.jobName || a.jobId);
        if (a.stageName) parts.push(`阶段:${a.stageName}`);
        if (a.activeStatus) parts.push(`状态:${a.activeStatus}`);
        if (a.deliveryType) parts.push(`渠道:${a.deliveryType}`);
        if (a.applyTime) parts.push(`时间:${a.applyTime}`);
        return parts.join(' / ') || (a.applicationId ? `投递 ${a.applicationId}` : '投递详情待确认');
    }).join('；');
}

/**
 * OCR 兜底：当 pdftotext 提取不到教育信息时，尝试将 PDF 转图片后用 tesseract 识别。
 * 依赖命令：pdftoppm + tesseract。若本机未安装，静默返回空字符串。
 * @param {string} filePath PDF文件绝对路径
 * @returns {string} OCR识别文本
 */
function extractPdfTextByOcr(filePath) {
    const { execFileSync } = require('child_process');
    const tesseractCmd = resolveCommand('tesseract', [
        'C:/Program Files/Tesseract-OCR/tesseract.exe',
        'C:/Program Files (x86)/Tesseract-OCR/tesseract.exe'
    ]);
    const pdftoppmCmd = resolveCommand('pdftoppm', [
        'C:/Users/Ye.Chen/AppData/Local/Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin/pdftoppm.exe'
    ]);
    if (!pdftoppmCmd || !tesseractCmd) return '';

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-ocr-'));
    const imgPrefix = path.join(tmpDir, 'page');
    try {
        // 只 OCR 前 2 页，教育背景通常在简历前半部分，避免批量筛选耗时过长。
        execFileSync(pdftoppmCmd, ['-f', '1', '-l', '2', '-r', '220', '-png', filePath, imgPrefix], {
            stdio: 'ignore',
            timeout: 20000
        });
        const images = fs.readdirSync(tmpDir)
            .filter(f => f.toLowerCase().endsWith('.png'))
            .map(f => path.join(tmpDir, f))
            .sort();
        let text = '';
        images.forEach(img => {
            try {
                text += execFileSync(tesseractCmd, [img, 'stdout', '-l', 'chi_sim+eng', '--psm', '6'], {
                    encoding: 'utf8',
                    maxBuffer: 2 * 1024 * 1024,
                    timeout: 30000,
                    stdio: ['ignore', 'pipe', 'ignore']
                }) + '\n';
            } catch (e) { /* 单页 OCR 失败时继续下一页 */ }
        });
        return text;
    } catch (e) {
        return '';
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
}

const RESUME_EXTENSIONS = ['.pdf', '.jpg', '.jpeg'];

function isResumeFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return RESUME_EXTENSIONS.includes(ext);
}

function isImageResume(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.jpg' || ext === '.jpeg';
}

function extractImageText(filePath) {
    const { execFileSync } = require('child_process');
    const tesseractCmd = resolveCommand('tesseract', [
        'C:/Program Files/Tesseract-OCR/tesseract.exe',
        'C:/Program Files (x86)/Tesseract-OCR/tesseract.exe'
    ]);
    if (!tesseractCmd) return '';
    try {
        return execFileSync(tesseractCmd, [filePath, 'stdout', '-l', 'chi_sim+eng', '--psm', '6'], {
            encoding: 'utf8',
            maxBuffer: 2 * 1024 * 1024,
            timeout: 30000,
            stdio: ['ignore', 'pipe', 'ignore']
        }) || '';
    } catch (e) {
        return '';
    }
}

function extractResumeText(filePath) {
    if (isImageResume(filePath)) {
        return extractImageText(filePath);
    }
    return extractPdfTextWithOcrFallback(filePath);
}

function hasEducationSignal(text) {
    return /(大学|学院|本科|硕士|研究生|博士|教育|学校|毕业|bachelor|master|phd)/i.test(text || '');
}

function extractPdfTextWithOcrFallback(filePath) {
    const raw = extractPdfText(filePath);
    if (hasEducationSignal(raw)) return raw;
    const ocr = extractPdfTextByOcr(filePath);
    return ocr ? `${raw}\n${ocr}` : raw;
}

/**
 * 清洗 Boss直聘 PDF 的混淆噪声
 * - 去掉长 hash 字符串（如 f894f45d3bf7c7751HBz09i1FVNYx4m5VvqZ...）
 * - 去掉表格式的虚线/竖线分割
 * - 合并分散字符（跨行分散的 hash 片段）
 * @param {string} raw 原始文本
 * @returns {string} 清洗后文本
 */
function cleanBossText(raw) {
    if (!raw) return '';
    let text = raw;
    // 1. 去掉长串 base64/hash 特征：≥25个字母数字混合且含大写小写
    text = text.replace(/[A-Za-z0-9+/=_\-]{25,}/g, ' ');
    // 2. 去掉 Boss 特有的 "HBz" hash 片段（如 f894,f4,5d3bf,7c7751HBz,...）
    text = text.replace(/[a-f0-9,]{8,}HBz[A-Za-z0-9,]+/g, ' ');
    text = text.replace(/HBz\d+[A-Za-z0-9,]+/g, ' ');
    // 3. 去掉孤立散落的 hash 短片段（全字母无意义）
    text = text.replace(/\b[A-Za-z]{15,}\b/g, ' ');
    // 4. 去掉邮箱/URL 中的 hash
    text = text.replace(/[a-f0-9]{8,}@[a-f0-9]{4,}/gi, '');
    // 5. 去掉管道竖线
    text = text.replace(/[\|,]{3,}/g, ',');
    // 6. 合并多余空白
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/[ \t]{3,}/g, ' ');
    // 7. 去掉孤立的单字符行（噪点）
    text = text.split('\n').filter(line => {
        const trimmed = line.trim();
        if (trimmed.length <= 1) return false;
        // 如果一行只有特殊字符，也跳过
        if (/^[,.\-_\|\\\/\[\]{}()]+$/.test(trimmed)) return false;
        return true;
    }).join('\n');
    return text.trim();
}

/**
 * 从清洗后的文本中检测候选人的技能
 * @param {string} text 清洗后的简历文本
 * @param {{ requiredSkills: string[], preferredSkills: string[] }} posSkills 岗位技能配置
 * @returns {{ matched: string[], matchedRequired: string[], matchedPreferred: string[], score: number }}
 */
function matchSkillsFromText(text, posSkills) {
    const textUpper = text.toUpperCase();
    const matchedRequired = [];
    const matchedPreferred = [];
    const lowerText = text.toLowerCase();

    const checkSkill = (skill) => {
        const s = skill.toLowerCase();
        // Boss直聘 PDF 经常把词连在一起（如 "ADBAPANOA"、"CanoeADBJira"），
        // 所以统一用子串匹配，不用 \b 边界
        return lowerText.includes(s);
    };

    (posSkills.requiredSkills || []).forEach(skill => {
        if (checkSkill(skill)) matchedRequired.push(skill);
    });

    (posSkills.preferredSkills || []).forEach(skill => {
        if (checkSkill(skill)) matchedPreferred.push(skill);
    });

    // 计算技能匹配分：Boss直聘 PDF 文本提取有限，使用平滑曲线
    // 匹配 0-2 个 → 30-45分，3-5个 → 50-70分，6-8个 → 70-85分，9+个 → 85-100分
    const matchedCount = matchedRequired.length + matchedPreferred.length;
    let score = 30; // baseline
    if (matchedCount >= 9) score = 85 + Math.min(15, (matchedCount - 9) * 3);
    else if (matchedCount >= 6) score = 65 + (matchedCount - 6) * 6;
    else if (matchedCount >= 4) score = 45 + (matchedCount - 4) * 10;
    else if (matchedCount >= 2) score = 30 + (matchedCount - 2) * 8;
    else if (matchedCount >= 1) score = 25;
    // 保底提高：如果行中有密集技能词汇，增加加分
    const bonusLines = text.split('\n').filter(l => {
        const matches = (posSkills.preferredSkills || []).filter(s => l.toLowerCase().includes(s.toLowerCase()));
        return matches.length >= 3;
    });
    if (bonusLines.length > 0) score = Math.min(100, score + 5);

    // 识别缺失技能
    const missingRequired = (posSkills.requiredSkills || []).filter(s => !matchedRequired.includes(s));

    return {
        matched: [...matchedRequired, ...matchedPreferred],
        matchedRequired,
        matchedPreferred,
        missingRequired,
        score: Math.round(Math.min(100, Math.max(20, score)))
    };
}

/**
 * 从文本中估算工作年限
 * @param {string} text 清洗后文本
 * @param {string} declaredExp 文件名中声明的工作年限（如 "3年"）
 * @returns {{ years: number, score: number, evidence: string }}
 */
function estimateExperience(text, declaredExp) {
    let years = 0;
    const isFreshGraduate = declaredExp.includes('应届') || declaredExp.includes('在校');

    // 1. 非应届候选人优先使用文件名中的经验声明
    if (!isFreshGraduate && declaredExp !== '未知') {
        const m = declaredExp.match(/(\d+)\s*年/);
        if (m) years = parseInt(m[1]);
    }

    // 2. 从工作/实习经历中的日期区间估算：按区间之和计算工作经验
    const experienceLines = text.split('\n').filter(line => {
        return /(工作经历|工作经验|实习经历|任职|公司|项目经历|项目经验|测试|开发|工程师|实习生)/.test(line)
            && !/(教育经历|教育背景|学历|本科|硕士|博士|大学|学院|学校|校园经历)/.test(line);
    });
    const expText = experienceLines.length > 0 ? experienceLines.join('\n') : text;
    const dateRanges = [...expText.matchAll(/(20\d{2})(?:[.\-\/年](\d{1,2}))?[月]?\s*(?:[-–~至到]|—)\s*((?:20\d{2})(?:[.\-\/年](\d{1,2}))?[月]?|至今|现在|目前|今)/g)];
    if (dateRanges.length > 0) {
        let totalMonths = 0;
        dateRanges.forEach(m => {
            const startYear = parseInt(m[1]);
            const startMonth = m[2] ? parseInt(m[2]) : 1;
            const endText = m[3];
            let endYear = 2026;
            let endMonth = 6;
            const endMatch = endText.match(/(20\d{2})(?:[.\-\/年](\d{1,2}))?/);
            if (endMatch) {
                endYear = parseInt(endMatch[1]);
                endMonth = endMatch[2] ? parseInt(endMatch[2]) : 12;
            }
            if (startYear >= 2000 && endYear <= 2028) {
                const months = (endYear - startYear) * 12 + (endMonth - startMonth + 1);
                if (months > 0 && months <= 180) totalMonths += months;
            }
        });
        if (totalMonths > 0) {
            const estimatedYears = Math.round((totalMonths / 12) * 10) / 10;
            if (isFreshGraduate) years = estimatedYears;
            else if (estimatedYears > years) years = estimatedYears;
        }
    }

    // 3. 非应届候选人如果文本中有明确年限声明，也纳入参考
    if (!isFreshGraduate) {
        const yearMatches = text.match(/(\d+)\s*年.*?(?:工作|经验|测试|ADAS|自动驾|从业)/);
        if (yearMatches) {
            const txtYears = parseInt(yearMatches[1]);
            if (txtYears > years) years = txtYears;
        }
    }

    // 4. 应届生没有工作/实习经历区间时，年限保持为 0
    if (isFreshGraduate && dateRanges.length === 0) {
        years = 0;
    }

    let score = 45;
    if (years >= 10) score = 95;
    else if (years >= 7) score = 85;
    else if (years >= 5) score = 75;
    else if (years >= 3) score = 65;
    else if (years >= 1) score = 55;

    return { years, score, evidence: `${years}年（文件名: ${declaredExp}）` };
}

/**
 * 从文本中检测教育信息
 * @param {string} text 清洗后文本
 * @returns {{ hasBachelor: boolean, hasMaster: boolean, hasPhD: boolean, schoolHint: string }}
 */
function detectEducation(text) {
    const hasBachelor = /本科/.test(text) || /bachelor/i.test(text);
    const hasMaster = /硕士/.test(text) || /master/i.test(text) || /研究生/.test(text);
    const hasPhD = /博士/.test(text) || /phd/i.test(text) || /doctor/i.test(text);

    const educationLines = text.split('\n').filter(line => {
        return /(教育经历|教育背景|学历|本科|硕士|研究生|博士|大学|学院|专业|学士|硕士学位|博士学位|bachelor|master|phd)/i.test(line);
    });
    const eduText = educationLines.length > 0 ? educationLines.join('\n') : text;

    const extractDegreeInfo = (degreePattern, degreeName) => {
        const lines = eduText.split('\n').filter(line => degreePattern.test(line));
        const line = lines[0] || '';
        if (!line) return null;
        const schoolMatch = line.match(/([一-龥]{2,}(?:大学|学院))/);
        const majorMatch = line.match(/([一-龥A-Za-z0-9（）()]{2,}(?:专业|工程|科学|技术|管理|车辆|自动化|计算机|电子|通信|软件|机械|机器人|数学|物理))/);
        return {
            degree: degreeName,
            school: schoolMatch ? schoolMatch[1] : '',
            major: majorMatch ? majorMatch[1].replace(/专业$/, '') : '',
            line: line.trim()
        };
    };

    const bachelorInfo = extractDegreeInfo(/本科|学士|bachelor/i, '本科');
    const masterInfo = extractDegreeInfo(/硕士|研究生|master/i, '硕士');

    // 尝试提取学校名称，优先取本科，其次硕士/博士线索
    let schoolHint = (bachelorInfo && bachelorInfo.school) || (masterInfo && masterInfo.school) || '';
    if (!schoolHint) {
        const schoolPatterns = [
            /([一-龥]{2,}(?:大学|学院))/g,
            /毕业[于院校].*?([一-龥]{2,}(?:大学|学院))/,
            /([一-龥]{2,}(?:大学|学院)).*?毕业/,
        ];
        for (const pat of schoolPatterns) {
            const m = text.match(pat);
            if (m) {
                const candidate = m[1] || m[0];
                if (!/时间|日期|经验|项目/.test(candidate) && candidate.length < 20) {
                    schoolHint = candidate;
                    break;
                }
            }
        }
    }

    return { hasBachelor, hasMaster, hasPhD, schoolHint, bachelorInfo, masterInfo };
}

/**
 * 从 PDF 文件解析候选人信息并评估
 * @param {string} filePath PDF 文件的绝对路径
 * @param {string} resumeName 候选人姓名
 * @param {string} declaredExp 文件名中的经验声明
 * @param {object} positionSkills skills_config 中该岗位的技能配置
 * @returns {object} 评估结果 { skillScore, expScore, eduScore, matchedSkills, missingSkills, extraSkills, analysis }
 */
function analyzeResumeFromPdf(filePath, resumeName, declaredExp, positionSkills) {
    // 提取和清洗文本
    const rawText = extractResumeText(filePath);
    const cleanText = cleanBossText(rawText);

    if (!cleanText || cleanText.length < 20) {
        // PDF 无法解析，给默认中等评分
        const w = scoringWeights;
        const fallbackSkillScore = 60;
        const fallbackExpScore = 60;
        const fallbackEduScore = 65;
        return {
            skillScore: fallbackSkillScore,
            expScore: fallbackExpScore,
            eduScore: fallbackEduScore,
            totalScore: Math.round(
                fallbackSkillScore * (w.skillWeight || 0.40) +
                fallbackExpScore * (w.expWeight || 0.35) +
                fallbackEduScore * (w.eduWeight || 0.25)
            ),
            matchedSkills: ['PDF内容未能提取，请手动查看'],
            missingSkills: ['建议打开PDF人工评估'],
            extraSkills: [],
            analysis: `${resumeName} 的简历 PDF 未能成功解析文本内容，建议打开 PDF 文件人工评估。当前评分仅供参考。`
        };
    }

    // 技能匹配
    const skillResult = matchSkillsFromText(cleanText, positionSkills);

    // 经验评估
    const expResult = estimateExperience(cleanText, declaredExp);

    // 教育检测
    const eduInfo = detectEducation(cleanText);

    // 提取额外技能（岗位未要求但文本中高频出现的专业词汇）
    const techKeywords = ['Python', 'C++', 'Java', 'MATLAB', 'Linux', 'CANoe', 'CANape', 'CAN', 'CAPL',
        'ADB', 'Jira', 'Git', 'Docker', 'Kubernetes', 'TensorFlow', 'PyTorch', 'ROS',
        'Simulink', 'CarMaker', 'Prescan', 'VTD', 'Carla', 'SUMOP', 'Trace32', 'UDS',
        'OTA', 'SOTIF', 'ASPICE', 'ISO26262', '功能安全', '预期功能安全',
        '以太网', 'SOME/IP', 'DDS', 'CMOS', 'LiDAR', '毫米波雷达', '超声波',
        'V2X', '高精地图', 'HDMAP', 'SLAM', '多传感器融合'];
    const extraSkills = [];
    techKeywords.forEach(kw => {
        if (cleanText.toLowerCase().includes(kw.toLowerCase()) &&
            !skillResult.matched.some(m => m.toLowerCase().includes(kw.toLowerCase()))) {
            extraSkills.push(kw);
        }
    });

    // 构建 matchedSkills/missingSkills 可读文本
    const matchedReadable = skillResult.matchedRequired.map(s => `${s}匹配`);
    const missingReadable = skillResult.missingRequired.map(s => `${s}待确认`);

    // 教育评分：博士、硕士、本科、其他四档；同一学历下学校层次越高分越高
    const highestSchool = (eduInfo.masterInfo && eduInfo.masterInfo.school)
        || (eduInfo.bachelorInfo && eduInfo.bachelorInfo.school)
        || eduInfo.schoolHint
        || '';
    const schoolBonus = getSchoolBonus(highestSchool);
    let eduLevel = '其他';
    let eduScore = 55;
    if (eduInfo.hasPhD) {
        eduLevel = '博士';
        eduScore = 90 + schoolBonus;
    } else if (eduInfo.hasMaster || eduInfo.masterInfo) {
        eduLevel = '硕士';
        eduScore = 80 + schoolBonus;
    } else if (eduInfo.hasBachelor || eduInfo.bachelorInfo) {
        eduLevel = '本科';
        eduScore = 70 + schoolBonus;
    } else {
        eduScore = 55 + schoolBonus;
    }
    eduScore = Math.min(100, Math.round(eduScore));

    // 综合评分
    const w = scoringWeights;
    const totalScore = Math.round(
        skillResult.score * (w.skillWeight || 0.40) +
        expResult.score * (w.expWeight || 0.35) +
        eduScore * (w.eduWeight || 0.25)
    );

    // 生成分析文本
    let analysis = `${resumeName}：`;
    if (matchedReadable.length > 0) {
        analysis += `具备 ${matchedReadable.slice(0, 5).join('、')} 等技能。`;
    } else {
        analysis += '简历文本中未明确检测到岗位要求的核心技能关键词。';
    }
    analysis += `工作年限估算约 ${expResult.years}年。`;
    const eduParts = [];
    if (eduInfo.bachelorInfo) {
        eduParts.push(`本科${eduInfo.bachelorInfo.school ? `-${eduInfo.bachelorInfo.school}` : ''}${eduInfo.bachelorInfo.major ? `-${eduInfo.bachelorInfo.major}` : ''}`);
    }
    if (eduInfo.masterInfo) {
        eduParts.push(`硕士${eduInfo.masterInfo.school ? `-${eduInfo.masterInfo.school}` : ''}${eduInfo.masterInfo.major ? `-${eduInfo.masterInfo.major}` : ''}`);
    }
    if (eduParts.length > 0) {
        analysis += `教育背景方面，识别到${eduParts.join('，')}。`;
    } else if (eduInfo.schoolHint) {
        analysis += `教育背景方面，文本中提及 "${eduInfo.schoolHint}"。`;
    }
    if (extraSkills.length > 0) {
        analysis += `额外发现：${extraSkills.slice(0, 4).join('、')}。`;
    }
    analysis += `建议结合简历详情进一步评估。`;

    return {
        skillScore: skillResult.score,
        expScore: expResult.score,
        eduScore,
        totalScore,
        matchedSkills: matchedReadable,
        missingSkills: missingReadable,
        extraSkills: extraSkills.slice(0, 8),
        pdfEduHint: eduInfo.schoolHint || '',
        educationInfo: {
            level: eduLevel,
            schoolLevel: getSchoolLevel(highestSchool),
            schoolBonus,
            bachelor: eduInfo.bachelorInfo,
            master: eduInfo.masterInfo,
            hasPhD: eduInfo.hasPhD
        },
        analysis
    };
}

// =====================================================
// 批量扫描 PDF 提取学校信息，更新 skills_config.json
// =====================================================

/**
 * 从 PDF 清洗文本中提取学校名称（更精准）
 * @param {string} text 清洗后的文本
 * @returns {string} 检测到的学校名或空字符串
 */
function extractSchoolFromText(text) {
    if (!text || text.length < 20) return '';
    // 从简到繁匹配
    for (const pat of [
        /([一-龥]{2,}(?:大学|学院))/g,
    ]) {
        const matches = text.match(pat);
        if (matches) {
            for (const m of matches) {
                // 排除非学校名的常见干扰词
                if (/时间|日期|经验|项目|方向|阶段|方法|技术|培训|学历|学位|专业|课程|毕业/.test(m)) continue;
                if (m.length > 8 || m.length < 4) continue;
                return m;
            }
        }
    }
    return '';
}

/**
 * 遍历所有简历 PDF 提取学校信息，并更新 skills_config.json 的 candidateSchools 字段
 * 不会覆盖已在 skills_config.json 中手动配置的学校信息
 * @param {Array} resumes 候选人列表（含 filePath、name）
 * @returns {Object} 更新后的 candidateSchools 对象
 */
function collectAndUpdateSchools(resumes, configPath) {
    const schoolMap = {};
    // 读取现有配置
    let config;
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch (e) { config = { candidateSchools: {} }; }
    const existingSchools = config.candidateSchools || {};

    console.log('\n🏫 批量提取候选人学校信息...');
    resumes.forEach(c => {
        const name = c.name;
        // 已配置的学校信息保留，不覆盖
        if (existingSchools[name] && existingSchools[name] !== '无学校信息') {
            schoolMap[name] = existingSchools[name];
            return;
        }
        // 尝试从简历文件提取
        let school = '';
        if (c.filePath && fs.existsSync(c.filePath)) {
            const raw = extractResumeText(c.filePath);
            const text = cleanBossText(raw);
            school = extractSchoolFromText(text);
        }
        if (school) {
            schoolMap[name] = school;
            console.log(`   ${name} → ${school}（文件提取）`);
        } else {
            schoolMap[name] = '无学校信息';
            console.log(`   ${name} → 无学校信息（未找到学校信息）`);
        }
    });

    // 写回 config 文件
    config.candidateSchools = schoolMap;
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        console.log(`✅ 已更新 ${configPath}`);
    } catch (e) {
        console.log(`⚠️  更新配置文件失败: ${e.message}`);
    }

    // 同步全局变量
    Object.assign(candidateSchools, schoolMap);
    return schoolMap;
}

// =====================================================
// 步骤1：扫描简历文件夹，从文件名提取岗位信息
// =====================================================
function scanResumes(resumeDir) {
    // 只扫描”简历”目录根层级中的简历文件（PDF、JPG/JPEG）。
    // 历史目录（如”6.4简历”）和本目录下已归档的日期文件夹都不参与本次筛选。
    let allFiles = [];
    try {
        allFiles = fs.readdirSync(resumeDir, { withFileTypes: true })
            .filter(entry => entry.isFile() && isResumeFile(entry.name))
            .map(entry => path.join(resumeDir, entry.name));
    } catch (e) {
        return [];
    }
    const resumes = [];
    allFiles.forEach(fullPath => {
        const fileName = path.basename(fullPath);
        const relPath = path.relative(resumeDir, fullPath);
        // 文件名格式：【岗位名称_地点 薪资】姓名 工作年限.pdf/.jpg
        const match = fileName.match(/^【(.+?)_(.+?)】(.+?)\.(pdf|jpe?g)$/i);
        if (match) {
            const fullPosition = match[1].trim();
            const locAndSalary = match[2].trim();
            const nameAndExp = match[3].trim();
            const nameExpMatch = nameAndExp.match(/^(.+?)\s+(\S+)$/);
            const name = nameExpMatch ? nameExpMatch[1].trim() : nameAndExp;
            const experience = nameExpMatch ? nameExpMatch[2].trim() : '未知';
            let location = locAndSalary;
            let salary = '面议';
            const lsMatch = locAndSalary.match(/^(.+?)\s+(\d[\dKk\-元/天_年]+)$/);
            if (lsMatch) {
                location = lsMatch[1].trim();
                salary = lsMatch[2].trim().replace(/_/g, '/');
            }
            resumes.push({ file: relPath, filePath: fullPath, fullPosition, location, salary, name, experience });
        } else {
            // 部分文件可能已被重命名，尝试从文件名提取姓名
            const nameOnly = fileName.replace(/\.(pdf|jpe?g)$/i, '').replace(/【.+?】/, '').trim();
            resumes.push({
                file: relPath, filePath: fullPath, fullPosition: '未知岗位', location: '未知', salary: '面议',
                name: nameOnly, experience: '未知'
            });
        }
    });
    return resumes;
}

// =====================================================
// 步骤2：从 岗位.md 按岗位提取要求
// =====================================================
function parsePositionRequirements(mdPath) {
    const content = fs.readFileSync(mdPath, 'utf8');
    const lines = content.split('\n');

    const headerLines = [];
    lines.forEach((line, idx) => {
        const m = line.trim().match(/^(\d+)\.(\S.*(?:工程师|实习生|经理|专员|专家|总监|主管|助理|负责人).*)$/);
        if (m) headerLines.push({ num: parseInt(m[1]), title: m[2].trim(), line: idx });
    });

    const positions = {};
    for (let h = 0; h < headerLines.length; h++) {
        const header = headerLines[h];
        const startLine = header.line;
        const endLine = h + 1 < headerLines.length ? headerLines[h + 1].line : lines.length;
        const sectionLines = lines.slice(startLine + 1, endLine).map(l => l.trim()).filter(l => l.length > 0);

        const posKey = header.title;
        positions[posKey] = {
            title: header.title,
            subDirections: [],
            requirements: [],
            responsibilities: [],
            allContent: sectionLines.join('\n')
        };
        const pos = positions[posKey];
        let inRequirements = false;
        let inResponsibilities = false;

        for (const line of sectionLines) {
            if (line.match(/实车测试工程师\s*[-–—]\s*/) ||
                (line.length < 30 && (line.includes('行泊方向') || line.includes('主动安全') || line.includes('基建')))) {
                pos.subDirections.push(line);
                inRequirements = false; inResponsibilities = false; continue;
            }
            if (line.match(/^(?:岗位|任职|职位)(?:要求|职责|描述)/) || line.match(/^工作职责/) || line.match(/^岗位职责/) ||
                line.includes('岗位要求：') || line.startsWith('岗位要求"') || line.includes('任职要求：') ||
                line.includes('职位要求：') || line.includes('职位要求：') || line.includes('职位描述：') || line.startsWith('任职要求"')) {
                inRequirements = line.includes('要求');
                inResponsibilities = line.includes('职责') || line.includes('描述');
                continue;
            }
            if (inRequirements && line.match(/^[\d、．.●◆\-]\s*/)) {
                let text = line.replace(/^[\d、．.●◆\-]\s*/, '').replace(/^["""]/, '').replace(/["""]$/, '').trim();
                // 跳过过短内容
                if (text.length > 4) pos.requirements.push(text);
            }
            if (inResponsibilities && line.match(/^[\d、．.●◆\-]\s*/)) {
                let text = line.replace(/^[\d、．.●◆\-]\s*/, '').trim();
                if (text.length > 4) pos.responsibilities.push(text);
            }
        }
        // 如果结构化解析失败，尝试从 allContent 全文提取
        if (pos.requirements.length === 0) {
            const reqSec = pos.allContent.match(/(?:岗位要求|任职要求|职位要求)[：:"\s]+([\s\S]*?)(?=\n(?:实车测试|职位要求|职位描述|$))/);
            if (reqSec) {
                pos.requirements = reqSec[1].split('\n').map(l => l.replace(/^[\d、．.●◆\-]\s*/, '').trim()).filter(l => l.length > 4 && !l.match(/^(?:岗位|任职|职位)/));
            }
        }
        // 对提取的要求进行去重和清洗
        const cleaned = [];
        const seenReqs = new Set();
        pos.requirements.forEach(r => {
            let clean = r.replace(/^[,、，．.\s]+/, '').replace(/["""]$/g, '').replace(/^["""]/, '').trim();
            // 跳过过短或明显无意义的行
            if (clean.length < 4 || clean.match(/^[\d+\-*•●◆]+$/)) return;
            // 去重（按前20个字符判断）
            const key = clean.substring(0, 20);
            if (seenReqs.has(key)) return;
            seenReqs.add(key);
            cleaned.push(clean);
        });
        pos.requirements = cleaned;
        if (pos.responsibilities.length === 0) {
            const respSec = pos.allContent.match(/(?:工作职责|岗位职责|职位描述)[：:"\s]+([\s\S]*?)(?=\n(?:任职要求|岗位要求|职位要求|$))/);
            if (respSec) {
                pos.responsibilities = respSec[1].split('\n').map(l => l.replace(/^[\d、．.●◆\-]\s*/, '').trim()).filter(l => l.length > 4);
            }
        }
    }
    return positions;
}

// =====================================================
// 步骤3：按岗位分组
// =====================================================
function groupByPosition(resumes, positions) {
    // 标准化括号：全角→半角，方便匹配
    const norm = s => s.replace(/[（(]/g, '(').replace(/[）)]/g, ')');
    const groups = {};
    resumes.forEach(resume => {
        const posName = resume.fullPosition;
        const posNameNorm = norm(posName);
        let matchedPos = positions[posName];
        if (!matchedPos) {
            for (const key of Object.keys(positions)) {
                const keyNorm = norm(key);
                // 先尝试精确匹配（标准化后）
                if (keyNorm === posNameNorm) { matchedPos = positions[key]; break; }
                // 再尝试去除括号内容匹配
                const base = keyNorm.replace(/\(.*?\)/g, '').trim();
                const posBase = posNameNorm.replace(/\(.*?\)/g, '').trim();
                if (posBase.includes(base) || base.includes(posBase) || base === posBase) { matchedPos = positions[key]; break; }
            }
        }
        // 如果简历文件名中的岗位在 岗位.md 中找不到，统一归入“无岗位”。
        // 这样报告和归档目录都能明确区分“未匹配到JD”的简历，避免散落到原始岗位名目录。
        const groupKey = matchedPos ? matchedPos.title : '无岗位';
        if (!groups[groupKey]) {
            groups[groupKey] = {
                positionTitle: matchedPos ? matchedPos.title : '无岗位',
                requirements: matchedPos ? matchedPos.requirements : [],
                responsibilities: matchedPos ? matchedPos.responsibilities : [],
                subDirections: matchedPos ? matchedPos.subDirections : [],
                candidates: []
            };
        }
        groups[groupKey].candidates.push(resume);
    });
    return groups;
}

// =====================================================
// 步骤4：AI分析（嵌入式分析逻辑）
// =====================================================

// 定义每个候选人的详细分析
function buildCandidateAnalyses(groups) {
    // 手动分析数据（从PDF提取的信息结合AI判断）

    // ====== 岗位1: 智能驾驶实车测试工程师(A99552) ======
    const group1 = groups['智能驾驶实车测试工程师(A99552)'];
    if (group1) {
        group1.candidates.forEach(c => {
            if (c.name === '郭宝才') {
                c.skillScore = 78;
                c.expScore = 75;
                c.eduScore = 70;
                c.totalScore = 76;
                c.recommendation = '推荐';
                c.matchedSkills = [
                    'ADAS/自动驾驶系统测试经验',
                    'APA自动泊车功能测试',
                    'AEB自动紧急制动测试',
                    'C-NCAP法规测试经验',
                    'CANoe/CAN工具使用',
                    'Linux系统操作',
                    'Jira缺陷管理',
                    '实车测试流程经验'
                ];
                c.missingSkills = [
                    '编程能力（Python/C++）需确认',
                    '规模化路试管理经验不足',
                    'HD-MAP验证经验待确认',
                    '传感器数据采集系统理解待确认',
                    '团队管理经验不足（仅3年经验）'
                ];
                c.extraSkills = [
                    'MobaXterm远程工具使用',
                    'Linux tail/head/cat等命令熟练',
                    '岗位薪资匹配度高（20-40K）'
                ];
                c.matchDetails = {
                    '熟悉ADAS/自动驾驶系统架构与功能': '匹配',
                    '熟悉相关测试流程和工具': '匹配',
                    '熟悉相关的技术标准、法规优先': '部分匹配',
                    '了解主流自动驾驶技术路线': '匹配',
                    '了解开发需求管理和系统方案设计': '部分匹配',
                    '熟悉执行器交互和性能指标': '部分匹配',
                    '了解目标融合逻辑和轨迹规划控制': '部分匹配',
                    '车辆驾驶技能熟练': '匹配',
                    '规模化路试验证管理经验': '需确认',
                    '编程语言(如C/C++/Python/Matlab)': '需确认',
                    '熟悉Linux系统': '匹配',
                    '软件技能:CANoe/CANape等': '匹配',
                    '团队管理经验': '无',
                    '有效驾驶执照': '匹配',
                    '工作经验': '3年（符合基本要求）'
                };
                c.analysis = '郭宝才具有3年ADAS实车测试经验，熟悉APA、AEB等功能的测试流程，掌握CANoe、Linux等工具。有C-NCAP法规测试经验，基本满足岗位核心要求。不足之处在于年限偏短，缺乏规模化路试和团队管理经验，编程能力待确认。建议进入面试，重点考察编程能力和项目深度。';
            } else if (c.name === '钱生') {
                c.skillScore = 88;
                c.expScore = 95;
                c.eduScore = 85;
                c.totalScore = 91;
                c.recommendation = '强烈推荐';
                c.matchedSkills = [
                    '资深ADAS/自动驾驶系统测试经验（10+年）',
                    '全栈ADAS功能测试（AEB/ACC/APA/BSD/LDPL等）',
                    'MATLAB/LINUX开发环境',
                    'CANape/CANoe专业工具链',
                    'ESP/EPS执行器测试经验',
                    '多段职业生涯（3家公司）',
                    '丰富的行业资源和测试方法论',
                    '管理层经验（带团队）'
                ];
                c.missingSkills = [
                    '需确认薪资期望是否符合20-40K范围',
                    '编程语言深度（Python/C++）待确认',
                    '传感器数据采集系统理解待确认',
                    'HD-MAP验证经验待确认'
                ];
                c.extraSkills = [
                    '10年以上智能驾驶领域深耕',
                    '完整参与多个ADAS项目全生命周期',
                    '跨公司多项目经验（适应性强）',
                    'ELK（可能指Elasticsearch技术栈）了解'
                ];
                c.matchDetails = {
                    '熟悉ADAS/自动驾驶系统架构与功能': '匹配',
                    '熟悉相关测试流程和工具': '匹配',
                    '熟悉相关的技术标准、法规优先': '匹配',
                    '了解主流自动驾驶技术路线': '匹配',
                    '了解开发需求管理和系统方案设计': '匹配',
                    '熟悉执行器交互和性能指标': '匹配',
                    '了解目标融合逻辑和轨迹规划控制': '部分匹配',
                    '车辆驾驶技能熟练': '匹配',
                    '规模化路试验证管理经验': '有',
                    '编程语言(如C/C++/Python/Matlab)': '部分匹配（MATLAB）',
                    '熟悉Linux系统': '匹配',
                    '软件技能:CANoe/CANape等': '匹配',
                    '团队管理经验': '有',
                    '有效驾驶执照': '匹配',
                    '工作经验': '10年以上（远超要求）'
                };
                c.analysis = '钱生具有10年以上智能驾驶测试经验，覆盖AEB、ACC、APA、BSD等核心ADAS功能。熟练掌握CANape/CANoe、MATLAB/Linux等工具链，具有团队管理经验。唯一需关注的是薪资期望：20-40K对10年经验资深工程师可能偏低，需确认候选人期望范围。总体高度匹配，强烈推荐进入面试。';
            }
        });
    }

    // ====== 岗位2: 智能驾驶数据测试实习生(A217292) ======
    const group2 = groups['智能驾驶数据测试实习生(A217292)'];
    if (group2) {
        group2.candidates.forEach(c => {
            if (c.name === '吕冰倩') {
                c.skillScore = 72;
                c.expScore = 70;
                c.eduScore = 80;
                c.totalScore = 73;
                c.recommendation = '需面试确认';
                c.matchedSkills = [
                    '本科学历（2019-2023，计算机相关专业方向）',
                    'Python编程能力',
                    'Linux系统基础了解',
                    '数据标注和AI相关经验',
                    '论文发表能力（SCI）',
                    '测试工具经验（MeterSphere, Postman）',
                    '数据库使用经验（Oracle）',
                    'CI/CD了解（Jenkins）'
                ];
                c.missingSkills = [
                    '需确认是否持有有效驾驶执照（C2及以上）',
                    '需确认ADAS/自动驾驶基本概念了解程度',
                    '智能驾驶数据标注经验待确认',
                    '主动安全法规知识待确认',
                    '实车测试经验为零',
                    '车辆工程/自动化相关专业背景待确认'
                ];
                c.extraSkills = [
                    'SCI论文发表（GAPillars，3D目标检测方向）',
                    'AI/Transformer研究经验',
                    'Postman接口测试、MeterSphere测试平台经验',
                    'GPA 3.5/4.0（前5%）',
                    'Redis、RAG等现代技术栈了解'
                ];
                c.matchDetails = {
                    '数据标注执行': '部分匹配（有AI数据处理经验）',
                    '数据问题分析': '部分匹配',
                    '测试报告撰写': '匹配',
                    '主动安全数据处理': '需确认',
                    '每日大屏维护': '需确认',
                    '维护内部培训': '需确认',
                    '本科及以上学历': '匹配',
                    '计算机/车辆工程/电子工程/自动化/机器人专业': '部分匹配（有计算机方向背景）',
                    '持有有效驾驶执照': '需确认',
                    '了解ADAS/自动驾驶基本概念': '部分匹配（有3D检测论文）',
                    '熟悉Linux基础命令': '匹配',
                    '掌握Python编程': '匹配',
                    '无人车/RobotMaster比赛经验': '需确认',
                    '学习能力和团队协作': '匹配',
                    '智驾评测项目经验': '部分匹配',
                    '主动安全项目经验': '需确认'
                };
                c.analysis = '吕冰倩为2023届本科毕业生，GPA优秀（前5%）。技术背景偏向AI和数据方向，有Python编程、测试工具（MeterSphere、Postman）和数据库经验。发表SCI论文（3D目标检测），对自动驾驶有一定理论基础。需确认驾驶执照持有情况和对ADAS基础概念的了解程度。作为实习生岗位，核心素质（学习能力、编程基础、理论基础）基本达标，建议进入面试环节全面评估。';
            }
        });
    }

    // ====== 岗位3: 实车测试工程师 — 使用 PDF 解析评分（已无硬编码覆盖） ======
    // 该岗位候选人的评分将由后续 PDF 解析自动完成

    // 为没有硬编码分析的候选人生成默认值 — 使用 PDF 文本解析评分
    Object.values(groups).forEach(group => {
        // 查找该岗位的技能配置
        const posSkills = skillsConfig.skills[group.positionTitle] || { requiredSkills: [], preferredSkills: [] };
        group.candidates.forEach(c => {
            if (c.totalScore === undefined || c.totalScore === null) {
                // 尝试从 PDF 解析
                if (c.filePath && fs.existsSync(c.filePath)) {
                    const pdfResult = analyzeResumeFromPdf(c.filePath, c.name, c.experience, posSkills);
                    Object.assign(c, pdfResult);
                    c.recommendation = c.totalScore >= 80 ? '推荐' : c.totalScore >= 70 ? '需面试确认' : '待定';
                    if (c.totalScore >= 80) c.recommendation = '推荐';
                    if (c.totalScore >= 90) c.recommendation = '强烈推荐';
                } else {
                    // 回退到默认值
                    c.skillScore = c.skillScore || 65;
                    c.expScore = c.expScore || 65;
                    c.eduScore = c.eduScore || 70;
                    const w = scoringWeights;
                    c.totalScore = Math.round(
                        (c.skillScore || 65) * (w.skillWeight || 0.40) +
                        (c.expScore || 65) * (w.expWeight || 0.35) +
                        (c.eduScore || 70) * (w.eduWeight || 0.25)
                    );
                    c.recommendation = c.recommendation || (c.totalScore >= 80 ? '推荐' : c.totalScore >= 70 ? '需面试确认' : '待定');
                }
                c.matchedSkills = c.matchedSkills || [];
                c.missingSkills = c.missingSkills || [];
                c.extraSkills = c.extraSkills || [];
                c.matchDetails = c.matchDetails || {};
                c.analysis = c.analysis || `${c.name}的简历分析待补充。当前综合评分${c.totalScore}，建议${c.recommendation === '推荐' || c.recommendation === '强烈推荐' ? '进入面试环节' : '进一步评估'}`;
            }
        });
    });

    return groups;
}

// =====================================================
// 步骤5：生成按岗位分组的CSV报告
// =====================================================
function getTierSummary(groups) {
    const goodThreshold = classCfg.合格阈值 || 60;
    const summary = { pass: 0, fail: 0, inTalentPool: 0, queryFailed: 0 };

    Object.values(groups).forEach(group => {
        group.candidates.forEach(c => {
            const tp = c.talentPool || {};
            if (tp.inPool) {
                summary.inTalentPool++;
                return;
            }
            if (tp.status === 'error') summary.queryFailed++;
            const score = c.totalScore || 0;
            const rec = (c.recommendation || '').trim();
            if (score >= goodThreshold || rec === '强烈推荐' || rec === '推荐' || rec === '需面试确认') {
                summary.pass++;
            } else {
                summary.fail++;
            }
        });
    });

    return summary;
}

function buildBriefCandidateSummary(candidate) {
    const highlights = [];
    if ((candidate.matchedSkills || []).length > 0) {
        highlights.push(`匹配技能：${candidate.matchedSkills.slice(0, 3).join('、')}`);
    }
    if ((candidate.missingSkills || []).length > 0) {
        highlights.push(`待确认：${candidate.missingSkills.slice(0, 2).join('、')}`);
    }
    if (candidate.educationInfo && candidate.educationInfo.level) {
        highlights.push(`学历：${candidate.educationInfo.level}`);
    }
    if (candidate.talentPool) {
        highlights.push(`人才库：${candidate.talentPool.inPool ? '已进入人才库' : (candidate.talentPool.message || '未查询')}`);
    }
    if (highlights.length === 0) {
        return '简历已完成基础分析，建议结合原始简历进一步评估。';
    }
    return highlights.join('；') + '。';
}

function generateGroupedReport(groups) {
    let csv = '﻿'; // BOM for UTF-8
    const tierSummary = getTierSummary(groups);

    csv += '简历匹配度分析报告（按岗位分组）\n';
    csv += `生成时间：${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}\n`;
    csv += `简历总数：${Object.values(groups).reduce((s,g) => s + g.candidates.length, 0)} 份\n`;
    csv += `已进入人才库：${tierSummary.inTalentPool} 份\n`;
    csv += `合格简历：${tierSummary.pass} 份\n`;
    csv += `不合格简历：${tierSummary.fail} 份\n`;
    if (tierSummary.queryFailed > 0) csv += `人才库查询失败/未确认：${tierSummary.queryFailed} 份\n`;
    csv += `岗位数：${Object.keys(groups).length} 个\n\n`;

    const groupNames = Object.keys(groups).sort();

    // ======================
    // 第一部分：候选人总览（按岗位分组）
    // ======================
    csv += '='.repeat(80) + '\n';
    csv += '第一部分：候选人总览（按岗位分组，组内按综合评分降序）\n';
    csv += '='.repeat(80) + '\n\n';

    groupNames.forEach(groupName => {
        const group = groups[groupName];
        const candidates = group.candidates;
        // 按综合评分降序
        candidates.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

        csv += `【岗位】${group.positionTitle}\n`;
        csv += `应聘人数：${candidates.length} 人\n`;
        if (group.subDirections.length > 0) {
            const cleanSubs = group.subDirections
                .map(s => s.replace(/^\d+\.\s*/, '').replace(/["""]$/, '').trim())
                .filter(s => s.length > 0 && s.length < 30 && !s.match(/^\d/));
            if (cleanSubs.length > 0) {
                csv += `子方向：${[...new Set(cleanSubs)].join('、')}\n`;
            }
        }
        csv += '\n';
        csv += '姓名,工作地点,薪资范围,工作年限,技能匹配度,经验匹配度,教育匹配度,综合评分,推荐等级,人才库状态,投递详情\n';

        candidates.forEach(c => {
            const poolStatus = c.talentPool && c.talentPool.inPool ? '已进入人才库' : (c.talentPool ? c.talentPool.message : '未查询');
            const appSummary = getApplicationSummary(c).replace(/,/g, '，');
            csv += `${c.name},${c.location},${c.salary},${c.experience},${c.skillScore},${c.expScore},${c.eduScore},${c.totalScore},${c.recommendation},${poolStatus},${appSummary}\n`;
        });
        csv += '\n';
    });

    // ======================
    // 第二部分：候选人简述（按岗位分组）
    // ======================
    csv += '\n' + '='.repeat(80) + '\n';
    csv += '第二部分：候选人简述（按岗位分组）\n';
    csv += '='.repeat(80) + '\n\n';

    groupNames.forEach(groupName => {
        const group = groups[groupName];
        const candidates = group.candidates;
        candidates.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

        csv += `\n【岗位】${group.positionTitle}\n`;
        csv += '-'.repeat(60) + '\n\n';

        candidates.forEach((c, idx) => {
            csv += `候选人 ${idx + 1}：${c.name}\n`;
            csv += `应聘岗位：${c.fullPosition}\n`;
            csv += `工作地点：${c.location}\n`;
            csv += `工作年限：${c.experience}\n`;
            csv += `综合评分：${c.totalScore}/100\n`;
            csv += `推荐等级：${c.recommendation}\n`;
            csv += `候选人简述：${buildBriefCandidateSummary(c)}\n\n`;
            csv += '-'.repeat(40) + '\n\n';
        });
    });

    // ======================
    // 第三部分：岗位要求对照（按岗位分组）
    // ======================
    csv += '\n' + '='.repeat(80) + '\n';
    csv += '第三部分：岗位要求对照（按岗位分组）\n';
    csv += '='.repeat(80) + '\n\n';

    groupNames.forEach(groupName => {
        const group = groups[groupName];
        const candidates = group.candidates;
        candidates.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

        csv += `【岗位】${group.positionTitle}\n\n`;

        if (group.responsibilities.length > 0) {
            csv += '岗位职责：\n';
            const seenResp = new Set();
            group.responsibilities.forEach(r => {
                const clean = r.replace(/^[,、，．.\s\d]+/, '').replace(/["""]$/g, '').trim();
                if (clean.length > 4 && !seenResp.has(clean)) {
                    seenResp.add(clean);
                    csv += `- ${clean}\n`;
                }
            });
            csv += '\n';
        }

        if (group.requirements.length > 0) {
            const headers = ['序号', '岗位要求'];
            candidates.forEach(c => { headers.push(c.name); });

            // 对要求去重并清理
            const seen = new Set();
            const cleanReqs = group.requirements.filter(req => {
                // 去除多余的标点符号
                const clean = req.replace(/^[,、，．.]+/, '').replace(/["""]$/g, '').trim();
                if (clean.length < 5 || seen.has(clean)) return false;
                seen.add(clean);
                return true;
            });

            csv += headers.join(',') + '\n';

            cleanReqs.forEach((req, idx) => {
                // 深度清洗：去除前导标点和数字
                let cleanReq = req.replace(/^[,、，．.\s\d]+/, '').replace(/^["""]+|["""]+$/g, '').trim();
                // CSV转义：如果含逗号则用引号包裹
                const csvReq = cleanReq.includes(',') ? `"${cleanReq}"` : cleanReq;
                const row = [idx + 1, csvReq];
                candidates.forEach(c => {
                    const md = c.matchDetails || {};
                    let matched = '待确认';
                    const cleanReqNorm = cleanReq.replace(/[，、；：\s]/g, '');
                    // 遍历所有 matchDetails 条目，使用最长公共子串匹配
                    let bestKey = null, bestLen = 0;
                    for (const key of Object.keys(md)) {
                        const cleanKey = key.replace(/[，、；：\s\[\]()]/g, '');
                        // 计算连续匹配的字符长度（滑动窗口）
                        const minLen = Math.min(cleanReqNorm.length, cleanKey.length);
                        let maxOverlap = 0;
                        for (let start = 0; start < cleanReqNorm.length; start++) {
                            for (let end = start + 8; end <= Math.min(start + 30, cleanReqNorm.length); end++) {
                                const sub = cleanReqNorm.substring(start, end);
                                if (cleanKey.includes(sub) && sub.length > maxOverlap) {
                                    maxOverlap = sub.length;
                                }
                            }
                        }
                        if (maxOverlap > bestLen) {
                            bestLen = maxOverlap;
                            bestKey = key;
                        }
                    }
                    // 要求匹配阈值：匹配长度至少达到要求的12%或5个字符
                    if (bestKey && bestLen >= Math.max(5, cleanReqNorm.length * 0.12)) {
                        matched = md[bestKey];
                    }
                    // 二次回退：用要求的前10个字符直接查找
                    if (matched === '待确认') {
                        const prefix = cleanReqNorm.substring(0, 10);
                        for (const [key, val] of Object.entries(md)) {
                            const ck = key.replace(/[，、；：\s\[\]()]/g, '');
                            if (ck.includes(prefix) || prefix.includes(ck.substring(0, 8))) {
                                matched = val; break;
                            }
                        }
                    }
                    row.push(matched);
                });
                csv += row.join(',') + '\n';
            });
        }
        csv += '\n';
    });

    // ======================
    // 第四部分：总结与建议
    // ======================
    csv += '\n' + '='.repeat(80) + '\n';
    csv += '第四部分：总结与建议\n';
    csv += '='.repeat(80) + '\n\n';

    groupNames.forEach(groupName => {
        const group = groups[groupName];
        const candidates = group.candidates;
        candidates.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));

        csv += `【${group.positionTitle}】\n`;
        if (candidates.length > 0) {
            const top = candidates[0];
            csv += `推荐候选人：${top.name}（综合评分${top.totalScore}，${top.recommendation}）\n`;
        }
        if (candidates.length > 1) {
            const second = candidates[1];
            csv += `备选候选人：${second.name}（综合评分${second.totalScore}，${second.recommendation}）\n`;
        }
        csv += '面试建议：\n';
        candidates.forEach(c => {
            csv += `- ${c.name}：建议考察${(c.missingSkills || []).slice(0, 3).join('、') || '核心技能'}\n`;
        });
        csv += '\n';
    });

    return csv;
}

// =====================================================
// 步骤6：按评分和岗位分类简历文件到本次筛选归档文件夹
// 结构：简历/筛选结果_{YYYYMMDD}/{合格/不合格}/{岗位名}/{候选人简历.pdf}
// =====================================================
function appendDeliveredResumeList(groups, listPath) {
    const pad = n => String(n).padStart(2, '0');
    const recordTitle = `## ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} 筛选记录`;
    const rows = [];

    Object.keys(groups).sort().forEach(groupName => {
        const group = groups[groupName];
        group.candidates
            .slice()
            .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
            .forEach(c => {
                rows.push(`| ${c.name} | ${group.positionTitle} | ${c.recommendation || '待定'} | ${c.totalScore || 0} |`);
            });
    });

    const lines = [
        recordTitle,
        '',
        '| 候选人 | 应聘岗位 | 推荐等级 | 综合评分 |',
        '|--------|----------|----------|----------|',
        ...rows,
        '',
        '---',
        ''
    ];

    if (!fs.existsSync(listPath)) {
        fs.writeFileSync(listPath, ['# 已投简历名单', '', ...lines].join('\n'), 'utf8');
        return;
    }

    let existing = fs.readFileSync(listPath, 'utf8');
    if (existing.length > 0 && !existing.endsWith('\n')) existing += '\n';
    if (!existing.endsWith('\n\n')) existing += '\n';
    fs.writeFileSync(listPath, existing + lines.join('\n'), 'utf8');
}

function classifyResumesByScore(groups, resumeDir, archiveRoot) {
    const goodThreshold = classCfg.合格阈值 || 60;
    const goodLabel = classCfg.合格文件夹名 || '合格简历';
    const failLabel = classCfg.不合格文件夹名 || '不合格简历';

    // 构建候选人姓名 -> (评分等级, 岗位名称) 映射
    // 等级: 'pass' / 'fail'
    const candidateMap = new Map(); // name → { tier, positionTitle }
    Object.values(groups).forEach(group => {
        const posTitle = group.positionTitle || '未知岗位';
        group.candidates.forEach(c => {
            const score = c.totalScore || 0;
            const rec = (c.recommendation || '').trim();
            let tier;
            if (c.talentPool && c.talentPool.inPool) {
                tier = 'inTalentPool';
            } else if (score >= goodThreshold || rec === '强烈推荐' || rec === '推荐' || rec === '需面试确认') {
                tier = 'pass';
            } else {
                tier = 'fail';
            }
            // 同一候选人可能投多个岗位，仅保留最高等级
            if (candidateMap.has(c.name)) {
                const existing = candidateMap.get(c.name);
                const rank = { inTalentPool: 3, pass: 2, fail: 1 };
                if (rank[tier] > rank[existing.tier]) {
                    candidateMap.set(c.name, { tier, positionTitle: posTitle });
                }
            } else {
                candidateMap.set(c.name, { tier, positionTitle: posTitle });
            }
        });
    });

    // 创建分隔符安全的目录名
    const sanitize = s => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim() || '未知岗位';

    // 顶层目录：统一放入本次筛选的日期归档文件夹
    const tierDirs = {
        pass: path.join(archiveRoot, goodLabel),
        fail: path.join(archiveRoot, failLabel),
        inTalentPool: path.join(archiveRoot, failLabel, '已进入人才库')
    };

    // 扫描简历目录中的所有简历文件（仅根层级，不递归子目录）
    const allFiles = fs.readdirSync(resumeDir).filter(f => {
        const full = path.join(resumeDir, f);
        return isResumeFile(f) && fs.statSync(full).isFile();
    });

    const moved = { pass: 0, fail: 0, inTalentPool: 0, skipped: 0 };
    const positionCounts = {}; // 统计各岗位各等级数量

    allFiles.forEach(file => {
        const srcPath = path.join(resumeDir, file);

        // 从文件名提取姓名和岗位
        const fileMatch = file.match(/^【(.+?)_(.+?)】(.+?)\.(pdf|jpe?g)$/i);
        let candidateName = file.replace(/\.(pdf|jpe?g)$/i, '').trim();
        let rawPosition = '未知岗位';
        if (fileMatch) {
            rawPosition = fileMatch[1].trim();
            const nameAndExp = fileMatch[3].trim();
            const nameExpMatch = nameAndExp.match(/^(.+?)\s+(\S+)$/);
            candidateName = nameExpMatch ? nameExpMatch[1].trim() : nameAndExp;
        }

        // 确定等级和岗位
        let tier = 'fail';
        let positionTitle = rawPosition;
        if (candidateMap.has(candidateName)) {
            const info = candidateMap.get(candidateName);
            tier = info.tier;
            positionTitle = info.positionTitle;
        } else {
            // 名字不完全匹配时模糊查找
            for (const [name, info] of candidateMap) {
                if (candidateName.includes(name) || name.includes(candidateName)) {
                    tier = info.tier;
                    positionTitle = info.positionTitle;
                    break;
                }
            }
        }

        const posDir = sanitize(positionTitle);
        const destBase = tierDirs[tier];
        const destDir = path.join(destBase, posDir);
        const destPath = path.join(destDir, file);

        // 创建目标目录
        fs.mkdirSync(destDir, { recursive: true });

        // 避免覆盖
        let finalDest = destPath;
        let counter = 1;
        while (fs.existsSync(finalDest)) {
            const ext = path.extname(file);
            const base = path.basename(file, ext);
            finalDest = path.join(destDir, `${base}_${counter}${ext}`);
            counter++;
        }

        try {
            fs.renameSync(srcPath, finalDest);
            moved[tier]++;
            // 统计
            const key = `${positionTitle}|${tier}`;
            positionCounts[key] = (positionCounts[key] || 0) + 1;
        } catch (e) {
            try {
                fs.copyFileSync(srcPath, finalDest);
                fs.unlinkSync(srcPath);
                moved[tier]++;
            } catch (e2) {
                console.log(`  ⚠️  移动失败: ${file} - ${e2.message}`);
                moved.skipped++;
            }
        }
    });

    return {
        tierDirs,
        moved,
        positionCounts,
        goodDir: tierDirs.pass,
        failDir: tierDirs.fail,
        inTalentPoolDir: tierDirs.inTalentPool,
        movedGood: moved.pass,
        movedFail: moved.fail,
        movedInTalentPool: moved.inTalentPool
    };
}

// =====================================================
// 主流程
// =====================================================
function main() {
    const resumeDir = path.join(PROJECT_ROOT, '简历');
    const mdPath = fs.existsSync(path.join(PROJECT_ROOT, '岗位.md'))
        ? path.join(PROJECT_ROOT, '岗位.md')
        : path.join(SKILL_ROOT, 'references', '岗位.md');
    const archiveRoot = path.join(resumeDir, `筛选结果_${dateStr}`);

    console.log('📂 扫描“简历”目录根层级中的简历文件...');
    const resumes = scanResumes(resumeDir);
    console.log(`   找到 ${resumes.length} 份简历`);
    console.log(`   归档目录：${archiveRoot}\n`);
    if (resumes.length === 0) {
        console.log('⚠️  未在”简历”目录根层级找到简历文件（PDF/JPG），请将待筛选简历放到该目录后重试。');
        return;
    }

    // ---- 批量提取学校信息并更新配置文件 ----
    const updatedSchools = collectAndUpdateSchools(resumes, CONFIG_PATH);

    console.log('\n📋 解析岗位要求...');
    const positions = parsePositionRequirements(mdPath);
    console.log(`   找到 ${Object.keys(positions).length} 个岗位`);
    Object.keys(positions).forEach(key => {
        console.log(`   - ${key} (${positions[key].requirements.length}项要求)`);
    });
    console.log();

    console.log('📊 按岗位分组...');
    const groups = groupByPosition(resumes, positions);
    Object.keys(groups).forEach(key => {
        console.log(`   【${key}】`);
        groups[key].candidates.forEach(c => {
            console.log(`      ├ ${c.name} | ${c.location} | ${c.salary} | ${c.experience}`);
        });
    });
    console.log();

    console.log('🤖 AI匹配分析...');
    const analyzedGroups = buildCandidateAnalyses(groups);
    console.log('   分析完成\n');

    // ---- 人才库查重 ----
    console.log('🔎 人才库查重...');
    let inPoolCount = 0, notInPoolCount = 0, poolUnknownCount = 0;
    Object.keys(analyzedGroups).forEach(key => {
        const group = analyzedGroups[key];
        group.candidates.forEach(c => {
            c.talentPool = checkTalentPool(c);
            if (c.talentPool.inPool) inPoolCount++;
            else if (['error', 'no_contact'].includes(c.talentPool.status)) poolUnknownCount++;
            else notInPoolCount++;
            console.log(`   ${c.name} → ${c.talentPool.inPool ? '已进入人才库' : c.talentPool.message}`);
        });
    });
    console.log(`   已进入人才库 ${inPoolCount} 人，未进入 ${notInPoolCount} 人，未确认 ${poolUnknownCount} 人\n`);

    // ---- 学历校验 ----
    console.log('🎓 学历校验...');
    let passCount = 0, failCount = 0;
    Object.keys(analyzedGroups).forEach(key => {
        const group = analyzedGroups[key];
        group.candidates.forEach(c => {
            c.educationCheck = checkEducation(c.name, group.positionTitle, c.pdfEduHint || '');
            if (c.educationCheck.pass) {
                passCount++;
            } else {
                failCount++;
            }
            console.log(`   ${c.name} → ${c.educationCheck.schoolName}（${c.educationCheck.schoolLevel}）：${c.educationCheck.pass ? '✅ 通过' : '❌ 不通过'} - ${c.educationCheck.reason}`);
        });
    });
    console.log(`   通过 ${passCount} 人，未通过 ${failCount} 人\n`);

    console.log('📝 生成报告...');
    const tierSummary = getTierSummary(analyzedGroups);
    fs.mkdirSync(archiveRoot, { recursive: true });
    if (skipCsvOutput) {
        console.log('   本次按要求跳过 CSV 输出，仅执行筛选分析与归档。');
    } else {
        const report = generateGroupedReport(analyzedGroups);
        const filename = `简历分析报告_${timestamp}.csv`;
        const filepath = path.join(archiveRoot, filename);
        fs.writeFileSync(filepath, report, 'utf8');
        console.log(`   报告已生成：${filename}`);
        console.log(`   文件路径：${filepath}`);
    }
    console.log(`   筛选统计：已进入人才库 ${tierSummary.inTalentPool} 份，合格 ${tierSummary.pass} 份，不合格 ${tierSummary.fail} 份`);
    console.log();

    // 输出摘要
    console.log('='.repeat(50));
    console.log('📋 报告摘要');
    console.log('='.repeat(50));
    Object.keys(analyzedGroups).sort().forEach(key => {
        const g = analyzedGroups[key];
        g.candidates.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
        console.log(`\n【${key}】`);
        g.candidates.forEach(c => {
            const poolMark = c.talentPool && c.talentPool.inPool ? ' | 已进入人才库' : '';
            console.log(`   ${c.name}：综合 ${c.totalScore}分 | 技能 ${c.skillScore} | 经验 ${c.expScore} | 教育 ${c.eduScore} | ${c.recommendation}${poolMark}`);
        });
    });

    // ---- 记录已投简历名单 ----
    const deliveredListPath = path.join(PROJECT_ROOT, '已投简历名单.md');
    appendDeliveredResumeList(analyzedGroups, deliveredListPath);
    console.log(`🗂️  已追加筛选记录：${deliveredListPath}`);

    // ---- 简历分类归档 ----
    console.log(`\n${'='.repeat(50)}`);
    console.log('📁 分类简历文件（合格/不合格 + 已进入人才库）...');
    console.log('='.repeat(50));
    const result = classifyResumesByScore(analyzedGroups, resumeDir, archiveRoot);

    // 展示各等级各岗位的分布
    console.log(`\n📂 ${path.relative(__dirname, result.tierDirs.pass)}/ → 每个岗位一个子文件夹`);
    Object.entries(result.positionCounts || {}).forEach(([key, count]) => {
        const [pos, tier] = key.split('|');
        if (tier === 'pass') { console.log(`   ├ ${pos}/ — ${count} 份`); }
    });
    console.log(`   └ 小计: ${result.moved.pass} 份`);

    console.log(`\n📂 ${path.relative(__dirname, result.tierDirs.fail)}/`);
    Object.entries(result.positionCounts || {}).forEach(([key, count]) => {
        const [pos, tier] = key.split('|');
        if (tier === 'fail') { console.log(`   ├ ${pos}/ — ${count} 份`); }
    });
    console.log(`   └ 小计: ${result.moved.fail} 份`);

    console.log(`\n📂 ${path.relative(__dirname, result.tierDirs.inTalentPool)}/`);
    Object.entries(result.positionCounts || {}).forEach(([key, count]) => {
        const [pos, tier] = key.split('|');
        if (tier === 'inTalentPool') { console.log(`   ├ ${pos}/ — ${count} 份`); }
    });
    console.log(`   └ 小计: ${result.moved.inTalentPool} 份`);

    if (result.moved.skipped > 0) {
        console.log(`\n   ⚠️  跳过 ${result.moved.skipped} 份（移动失败）`);
    }
    console.log('\n✅ 全部完成！');
}

main();