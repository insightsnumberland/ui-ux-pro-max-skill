// Product categories — loaded from API, fallback to mock
const CATS = {
    products: [
        { id: 1, name: 'کارت ویزا مجازی ۱۰ دلاری', price: 8500000 },
        { id: 2, name: 'کارت ویزا مجازی ۲۵ دلاری', price: 21000000 },
        { id: 3, name: 'کارت ویزا مجازی ۵۰ دلاری', price: 42000000 },
    ],
    practical: [
        { id: 6, name: 'اکانت Gmail', price: 250000 },
        { id: 7, name: 'اکانت Google Workspace', price: 1200000 },
    ],
    intelligence: [
        { id: 11, name: 'اکانت ChatGPT Plus', price: 2200000 },
        { id: 12, name: 'اکانت Claude Pro', price: 2100000 },
    ]
};

const pmap = {};
function rebuildPmap() {
    Object.keys(pmap).forEach(k => delete pmap[k]);
    Object.values(CATS).flat().forEach(p => { pmap[p.id] = p; });
}
rebuildPmap();

const STATUS = {
    PENDING: 'در حال بررسی',
    AWAITING_PAYMENT: 'در انتظار پرداخت',
    EXECUTING: 'در حال اجرا',
    COMPLETED: 'تکمیل شده',
    REJECTED: 'رد شده'
};

let requests = JSON.parse(localStorage.getItem('nb_reqs') || '[]');

// Toast
function showToast(msg, type = 'ok') {
    const c = document.getElementById('toast-cnt');
    if (!c) return;
    const t = document.createElement('div');
    const icon = type === 'ok'
        ? `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>`;
    t.className = `toast ${type}`;
    t.innerHTML = icon + msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

// Normalize API product item → {id, name, price (in Rial)}
function normalizeItems(arr) {
    return (arr || []).map(p => {
        // Rial-denominated fields (priority)
        const rialRaw = p.price_rial ?? p.unit_price_rial ?? p.b2b_price ??
                        p.base_price ?? p.amount_rial ?? p.sell_price_rial ??
                        p.final_price_rial ?? null;
        // Toman-denominated fields (×10 → Rial)
        const tomanRaw = p.price_toman ?? p.toman_price ?? p.sell_price_toman ??
                         p.final_price_toman ?? null;
        // Generic / unknown unit fields
        const genericRaw = p.price ?? p.sell_price ?? p.final_price ??
                           p.amount ?? p.cost ?? p.value ?? null;

        let price = 0;
        if (rialRaw !== null && typeof rialRaw === 'number' && rialRaw > 1000) {
            price = rialRaw;
        } else if (tomanRaw !== null && typeof tomanRaw === 'number' && tomanRaw > 100) {
            price = tomanRaw * 10; // convert Toman → Rial for internal storage
        } else if (genericRaw !== null && typeof genericRaw === 'number' && genericRaw > 1000) {
            price = genericRaw;
        }

        return {
            id: p.id ?? p.product_id,
            name: p.name || p.title || p.product_name || p.label || '',
            price
        };
    }).filter(p => p.id && p.name);
}

// ================================================================
// LOGIN PAGE (login.html)
// ================================================================
if (document.getElementById('lusername')) {

    if (localStorage.getItem('nb_on') === '1') {
        window.location.href = 'index.html';
    }

    let mockOtp = '';

    function switchAuthTab(tab) {
        ['login', 'register'].forEach(t => {
            document.getElementById('atab-' + t).classList.toggle('active', t === tab);
            document.getElementById('apanel-' + t).classList.toggle('active', t === tab);
        });
        document.getElementById('lerror').textContent = '';
        const rerr = document.getElementById('rerror');
        if (rerr) rerr.textContent = '';
    }

    document.getElementById('atab-login').addEventListener('click', () => switchAuthTab('login'));
    document.getElementById('atab-register').addEventListener('click', () => switchAuthTab('register'));

    // ── Login ──
    function doLogin() {
        const u = document.getElementById('lusername').value.trim();
        const p = document.getElementById('lpassword').value.trim();
        const err = document.getElementById('lerror');

        if (!u || !p) {
            err.textContent = 'لطفاً نام کاربری و رمز عبور را وارد کنید';
            return;
        }

        if (u === 'admin' && p === '123456') {
            err.textContent = '';
            showToast('ورود موفقیت‌آمیز بود. در حال انتقال...');
            localStorage.setItem('nb_on', '1');
            setTimeout(() => { window.location.href = 'index.html'; }, 1000);
        } else {
            err.textContent = 'نام کاربری یا رمز عبور اشتباه است';
            showToast('اطلاعات ورود اشتباه است', 'err');
        }
    }

    document.getElementById('lusername').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('lpassword').focus();
    });
    document.getElementById('lpassword').addEventListener('keydown', e => {
        if (e.key === 'Enter') doLogin();
    });

    // ── Register Step 1 ──
    function doRegister() {
        const mobile  = document.getElementById('reg-mobile').value.trim();
        const company = document.getElementById('reg-company').value.trim();
        const email   = document.getElementById('reg-email').value.trim();
        const err     = document.getElementById('rerror');

        if (!mobile) { err.textContent = 'شماره موبایل الزامی است'; document.getElementById('reg-mobile').focus(); return; }
        if (!/^09[0-9]{9}$/.test(mobile)) { err.textContent = 'شماره موبایل معتبر نیست (مثال: 09123456789)'; document.getElementById('reg-mobile').focus(); return; }
        if (!company) { err.textContent = 'نام شرکت الزامی است'; document.getElementById('reg-company').focus(); return; }
        if (!email) { err.textContent = 'ایمیل الزامی است'; document.getElementById('reg-email').focus(); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'فرمت ایمیل صحیح نیست'; document.getElementById('reg-email').focus(); return; }

        err.textContent = '';
        const btn = document.getElementById('reg-btn');
        const btnTxt = document.getElementById('reg-btn-txt');
        btn.disabled = true;
        btnTxt.textContent = 'در حال ارسال...';

        mockOtp = String(Math.floor(1000 + Math.random() * 9000));

        setTimeout(() => {
            btn.disabled = false;
            btnTxt.textContent = 'دریافت کد تأیید';
            document.getElementById('reg-step1').classList.add('hid');
            document.getElementById('reg-step2').classList.remove('hid');
            document.getElementById('otp-phone-display').textContent = 'کد تأیید به شماره ' + mobile + ' ارسال شد';
            document.getElementById('otp-demo-val').textContent = mockOtp;
            document.getElementById('otp-input').value = '';
            document.getElementById('otperror').textContent = '';
            document.getElementById('otp-input').focus();
            showToast('کد تأیید ارسال شد');
        }, 1200);
    }

    // ── Register Step 2: OTP verify → login directly ──
    function doVerifyOtp() {
        const entered = document.getElementById('otp-input').value.trim();
        const err = document.getElementById('otperror');

        if (!entered) { err.textContent = 'لطفاً کد تأیید را وارد کنید'; return; }
        if (entered.length < 4) { err.textContent = 'کد تأیید باید ۴ رقم باشد'; return; }

        const btn = document.getElementById('otp-btn');
        const btnTxt = document.getElementById('otp-btn-txt');
        btn.disabled = true;
        btnTxt.textContent = 'در حال بررسی...';

        setTimeout(() => {
            if (entered === mockOtp) {
                err.textContent = '';
                // ثبت‌نام موفق → مستقیم وارد پنل
                localStorage.setItem('nb_on', '1');
                showToast('ثبت‌نام موفقیت‌آمیز بود! در حال ورود به پنل...');
                setTimeout(() => { window.location.href = 'index.html'; }, 1500);
            } else {
                btn.disabled = false;
                btnTxt.textContent = 'تأیید و ثبت نام';
                err.textContent = 'کد وارد شده اشتباه است. دوباره امتحان کنید';
                showToast('کد تأیید اشتباه است', 'err');
                document.getElementById('otp-input').value = '';
                document.getElementById('otp-input').focus();
            }
        }, 900);
    }

    function goBackToRegForm() {
        document.getElementById('reg-step2').classList.add('hid');
        document.getElementById('reg-step1').classList.remove('hid');
        document.getElementById('otp-input').value = '';
        document.getElementById('otperror').textContent = '';
        mockOtp = '';
    }

    const otpInput = document.getElementById('otp-input');
    if (otpInput) {
        otpInput.addEventListener('input', function () { this.value = this.value.replace(/[^0-9]/g, ''); });
        otpInput.addEventListener('keydown', e => { if (e.key === 'Enter') doVerifyOtp(); });
    }
}

// ================================================================
// APP PAGE (index.html)
// ================================================================
if (document.getElementById('tab-dashboard')) {

    if (localStorage.getItem('nb_on') !== '1') {
        window.location.href = 'login.html';

    }

    let pending = null;
    let selectedModel = null; // 1 | 2 | 3

    // ── Load products from API ──
    async function loadProducts() {
        try {
            const token = localStorage.getItem('nb_token') || '';
            const headers = { 'Accept': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;

            const res = await fetch('https://api.numberland.ir/api/landing-products', { headers });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const json = await res.json();

            // ── Full debug dump (open DevTools Console to inspect) ──
            console.log('[NB] API response keys:', Object.keys(json));
            const d = json.data || json;
            console.log('[NB] data keys:', Object.keys(d));

            // Find products in all common response shapes
            const findArr = (obj, key) => Array.isArray(obj?.[key]) ? obj[key] : [];
            const prodArr    = findArr(d, 'products') || findArr(json, 'products');
            const practArr   = findArr(d?.accounts, 'practical') || findArr(d, 'practical');
            const intellArr  = findArr(d?.accounts, 'intelligence') || findArr(d, 'intelligence');

            // Log every field of the first product in each category so we can see the price field name
            [['products', prodArr], ['practical', practArr], ['intelligence', intellArr]].forEach(([cat, arr]) => {
                if (arr[0]) {
                    console.log(`[NB] ${cat}[0] all fields:`, JSON.stringify(arr[0], null, 2));
                } else {
                    console.log(`[NB] ${cat}: empty or not found`);
                }
            });

            const p = normalizeItems(prodArr);
            const r = normalizeItems(practArr);
            const i = normalizeItems(intellArr);

            if (p.length) { CATS.products = p;     console.log('[NB] products loaded:', p.length, 'items, first price Rial:', p[0]?.price); }
            if (r.length) { CATS.practical = r;    console.log('[NB] practical loaded:', r.length, 'items, first price Rial:', r[0]?.price); }
            if (i.length) { CATS.intelligence = i; console.log('[NB] intelligence loaded:', i.length, 'items, first price Rial:', i[0]?.price); }

            rebuildPmap();
        } catch (e) {
            console.warn('[NB] API fetch failed, using fallback data:', e.message);
        }
    }

    // LOGOUT
    function doLogout() {
        localStorage.removeItem('nb_on');
        showToast('از حساب خارج شدید');
        setTimeout(() => { window.location.href = 'login.html'; }, 800);
    }

    // TABS
    function switchTab(tab) {
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const panel = document.getElementById('tab-' + tab);
        if (panel) panel.classList.add('active');
        const btn = document.querySelector('.nav-btn[data-tab="' + tab + '"]');
        if (btn) btn.classList.add('active');
        if (tab === 'dashboard') renderDash();
        if (tab === 'request-list') renderTable();
        if (tab === 'discount-models') renderDiscountModels();
        if (tab === 'new-request') renderModelBanner();
    }

    const MODEL_MIN_QTY = { 1: 2, 2: 50, 3: 100 };

    function selectModel(n) {
        selectedModel = n;
        // Set qty to model's minimum and update stepper bounds
        const minQty = MODEL_MIN_QTY[n] || 1;
        const qtyInput = document.getElementById('input-qty');
        if (qtyInput) {
            qtyInput.min = minQty;
            qtyInput.value = minQty;
        }
        switchTab('new-request');
        document.querySelector('.app-content').scrollTo({ top: 0, behavior: 'smooth' });
    }

    function renderModelBanner() {
        const banner = document.getElementById('selected-model-banner');
        const formArea = document.getElementById('req-form-area');
        const noModelMsg = document.getElementById('no-model-msg');
        if (!banner) return;

        if (!selectedModel) {
            if (formArea) formArea.classList.add('hid');
            if (noModelMsg) noModelMsg.classList.remove('hid');
            return;
        }

        if (noModelMsg) noModelMsg.classList.add('hid');
        if (formArea) formArea.classList.remove('hid');

        const info = [null,
            { num: '۱', label: 'سازمان‌های کوچک · تخفیف ثابت هر اکانت',    range: '۲ تا ۴۹ نفر',      cls: 'mb-amber' },
            { num: '۲', label: 'سازمان‌های متوسط · تخفیف درصدی هر واحد',   range: '۵۰ تا ۹۹ نفر',     cls: 'mb-green' },
            { num: '۳', label: 'سازمان‌های بزرگ · تخفیف روی کل فاکتور',    range: '۱۰۰ نفر و بیشتر',  cls: 'mb-blue'  },
        ][selectedModel];

        banner.className = `model-banner ${info.cls}`;
        banner.innerHTML = `
            <div class="mb-info">
                <span class="mb-badge">مدل ${info.num}</span>
                <strong class="mb-label">${info.label}</strong>
                <span class="mb-sep">·</span>
                <span class="mb-range">${info.range}</span>
            </div>
            <button type="button" class="mb-change" onclick="switchTab('discount-models')">تغییر مدل</button>`;
    }

    function renderDiscountModels() {
        const container = document.getElementById('dm-container');
        if (!container) return;
        const fa = n => n === Infinity ? '∞' : n.toLocaleString('fa-IR');

        const fixedRows = B2B_CONFIG.fixed.map(t => `
            <div class="dm-row">
                <span class="dm-rng">${fa(t.min)} تا ${fa(t.max)} نفر</span>
                <span class="dm-disc dm-disc-amber">${fa(t.amountToman)} تومان</span>
            </div>`).join('');

        const pctRows = B2B_CONFIG.percent.map(t => `
            <div class="dm-row">
                <span class="dm-rng">${fa(t.min)} تا ${fa(t.max)} نفر</span>
                <span class="dm-disc dm-disc-green">${t.pct}٪</span>
            </div>`).join('');

        const invRows = B2B_CONFIG.invoice.map(t => `
            <div class="dm-row">
                <span class="dm-rng">${fa(t.min)}${t.max === Infinity ? ' نفر و بیشتر' : ' تا ' + fa(t.max) + ' نفر'}</span>
                <span class="dm-disc dm-disc-blue">${t.pct}٪</span>
            </div>`).join('');

        const nums = ['','۱','۲','۳'];
        const card = (n, title, range, desc, h1, h2, rows, cap) => `
            <div class="dm-card dm-card-${n}${selectedModel === n ? ' dm-card-active' : ''}">
                <div class="dm-head">
                    <span class="dm-badge dm-badge-${n}">مدل ${nums[n]}</span>
                    <div class="dm-title">${title}</div>
                    <div class="dm-range">${range}</div>
                </div>
                <p class="dm-desc">${desc}</p>
                <div class="dm-col-head"><span>${h1}</span><span>${h2}</span></div>
                <div class="dm-rows">${rows}</div>
                <div class="dm-cap">${cap}</div>
                <div class="dm-foot">
                    <button type="button"
                        class="dm-select-btn${selectedModel === n ? ' dm-selected' : ''}"
                        onclick="selectModel(${n})">
                        ${selectedModel === n ? '✓ مدل فعلی شما' : 'انتخاب این مدل'}
                    </button>
                </div>
            </div>`;

        container.innerHTML = `<div class="dm-grid">
            ${card(1,'سازمان‌های کوچک','۲ تا ۴۹ نفر',
                'به ازای هر اکانتی که سفارش می‌دهید یک مبلغ ثابت تخفیف می‌گیرید — صرف‌نظر از قیمت محصول.',
                'تعداد نفرات','تخفیف هر اکانت', fixedRows,
                'سقف تخفیف: ۲۵۰٬۰۰۰ تومان به ازای هر اکانت')}
            ${card(2,'سازمان‌های متوسط','۵۰ تا ۹۹ نفر',
                'تخفیف به‌صورت درصدی از قیمت هر اکانت محاسبه می‌شود — هر چه تعداد بیشتر، درصد بالاتر.',
                'تعداد نفرات','تخفیف روی هر واحد', pctRows,
                'سقف تخفیف در این لایه: ۱۰٪')}
            ${card(3,'سازمان‌های بزرگ','۱۰۰ نفر و بیشتر',
                'تخفیف درصدی روی مبلغ نهایی پیش‌فاکتور اعمال می‌شود — مناسب خریدهای انبوه سازمانی.',
                'تعداد نفرات','تخفیف کل فاکتور', invRows,
                'سقف تخفیف در این لایه: ۲۰٪')}
        </div>`;
    }

    document.querySelectorAll('.nav-btn').forEach(b => {
        b.addEventListener('click', () => switchTab(b.dataset.tab));
    });

    // CATEGORY CHANGE — uses CATS (API data)
    document.getElementById('input-category').addEventListener('change', function () {
        const cat = this.value;
        const ps = document.getElementById('input-product');
        if (!cat) {
            ps.innerHTML = '<option value="">ابتدا دسته بندی را انتخاب کنید</option>';
            return;
        }
        const items = CATS[cat] || [];
        if (items.length === 0) {
            ps.innerHTML = '<option value="">محصولی در این دسته وجود ندارد</option>';
            return;
        }
        ps.innerHTML = '<option value="">انتخاب محصول</option>';
        items.forEach(item => {
            const o = document.createElement('option');
            o.value = item.id;
            o.textContent = item.name;
            ps.appendChild(o);
        });
        // reset qty and price preview when category changes
        document.getElementById('input-qty').value = 1;
        document.getElementById('qty-fsec').classList.add('hid');
        document.getElementById('price-preview').classList.add('hid');
    });

    // ── B2B Discount Config ───────────────────────────────────
    // Edit tiers here. Amounts in Toman (×10 = Rial).
    const B2B_CONFIG = {
        // Model 1 — fixed Toman deduction per seat (qty 2–49)
        fixed: [
            { min: 2,  max: 9,  amountToman: 50_000  },
            { min: 10, max: 19, amountToman: 120_000 },
            { min: 20, max: 29, amountToman: 200_000 },
            { min: 30, max: 49, amountToman: 250_000 },
        ],
        // Model 2 — % off unit price (qty 50–99)
        percent: [
            { min: 50, max: 74, pct: 8  },
            { min: 75, max: 99, pct: 10 },
        ],
        // Model 3 — % off total invoice (qty 100+)
        invoice: [
            { min: 100, max: 149, pct: 12 },
            { min: 150, max: 199, pct: 15 },
            { min: 200, max: 299, pct: 18 },
            { min: 300, max: Infinity, pct: 20 },
        ],
    };

    // Returns { type, model, amountRial, pct, label }
    function getB2bDiscount(qty) {
        if (qty <= 1) return { type: 'none', model: null, amountRial: 0, pct: 0, label: '' };

        // Helper: find best tier (matching or highest fallback)
        function bestTier(tiers, q) {
            let match = tiers[tiers.length - 1];
            for (const t of tiers) {
                if (q >= t.min && q <= (t.max ?? Infinity)) { match = t; break; }
                if (q < t.min) { match = tiers[0]; break; }
            }
            return match;
        }

        if (selectedModel === 1) {
            const t = bestTier(B2B_CONFIG.fixed, qty);
            return { type: 'fixed', model: 1, amountRial: t.amountToman * 10, pct: 0,
                label: `مدل ۱ · ${t.amountToman.toLocaleString('fa-IR')} تومان/نفر` };
        }
        if (selectedModel === 2) {
            const t = bestTier(B2B_CONFIG.percent, qty);
            return { type: 'percent', model: 2, amountRial: 0, pct: t.pct,
                label: `مدل ۲ · ${t.pct}٪ روی هر واحد` };
        }
        if (selectedModel === 3) {
            const t = bestTier(B2B_CONFIG.invoice, qty);
            return { type: 'invoice', model: 3, amountRial: 0, pct: t.pct,
                label: `مدل ۳ · ${t.pct}٪ روی کل فاکتور` };
        }

        // Auto-detect (no model pre-selected)
        for (const t of B2B_CONFIG.fixed)
            if (qty >= t.min && qty <= t.max)
                return { type: 'fixed', model: 1, amountRial: t.amountToman * 10, pct: 0,
                    label: `مدل ۱ · ${t.amountToman.toLocaleString('fa-IR')} تومان/نفر` };
        for (const t of B2B_CONFIG.percent)
            if (qty >= t.min && qty <= t.max)
                return { type: 'percent', model: 2, amountRial: 0, pct: t.pct,
                    label: `مدل ۲ · ${t.pct}٪ روی هر واحد` };
        for (const t of B2B_CONFIG.invoice)
            if (qty >= t.min && qty <= (t.max ?? Infinity))
                return { type: 'invoice', model: 3, amountRial: 0, pct: t.pct,
                    label: `مدل ۳ · ${t.pct}٪ روی کل فاکتور` };
        return { type: 'none', model: null, amountRial: 0, pct: 0, label: '' };
    }

    // Rial → Toman display helper
    const toToman = rial => Math.round(rial / 10).toLocaleString('fa-IR');

    // PRICE PREVIEW
    function updatePricePreview() {
        const pid = parseInt(document.getElementById('input-product').value);
        const qty = Math.max(1, parseInt(document.getElementById('input-qty').value) || 1);
        const preview = document.getElementById('price-preview');
        const qtyFsec = document.getElementById('qty-fsec');

        if (!pid || !pmap[pid]) {
            qtyFsec.classList.add('hid');
            preview.classList.add('hid');
            return;
        }
        qtyFsec.classList.remove('hid');

        const prod = pmap[pid];
        const unitPrice = prod.price || 0;

        if (!unitPrice) {
            preview.classList.add('hid');
            return;
        }

        const disc = getB2bDiscount(qty);
        const subtotal = unitPrice * qty;
        let discAmt = 0;
        let total = subtotal;
        if (disc.type === 'fixed') {
            discAmt = disc.amountRial * qty;
            total = subtotal - discAmt;
        } else if (disc.type === 'percent' || disc.type === 'invoice') {
            discAmt = Math.round(subtotal * disc.pct / 100);
            total = subtotal - discAmt;
        }

        document.getElementById('pp-unit').textContent = toToman(unitPrice) + ' تومان';

        const discRow = document.getElementById('pp-discount-row');
        const discEl = document.getElementById('pp-discount');
        if (disc.type !== 'none' && discAmt > 0) {
            discRow.style.display = '';
            discEl.innerHTML = `<span class="pp-disc-badge">${disc.label}</span><span class="pp-disc-amt"> −${toToman(discAmt)} تومان</span>`;
        } else {
            discRow.style.display = 'none';
        }

        document.getElementById('pp-total').textContent = toToman(total) + ' تومان';
        preview.classList.remove('hid');

        // Adapt form fields based on qty (single account vs. multi-seat B2B)
        const credsSection = document.getElementById('creds-section');
        const b2bSection = document.getElementById('b2b-note-section');
        const emailLabel = document.getElementById('email-label');
        const emailInput = document.getElementById('input-email');

        if (qty === 1) {
            credsSection.classList.remove('hid');
            b2bSection.classList.add('hid');
            emailLabel.innerHTML = 'ایمیل اکانت <span class="req">*</span>';
            emailInput.placeholder = 'example@domain.com';
        } else {
            credsSection.classList.add('hid');
            b2bSection.classList.remove('hid');
            emailLabel.innerHTML = 'ایمیل نماینده سازمان <span class="req">*</span>';
            emailInput.placeholder = 'contact@company.com';
        }
    }

    // PRODUCT SELECTION — show qty + price preview
    document.getElementById('input-product').addEventListener('change', updatePricePreview);

    // QTY STEPPER
    document.getElementById('input-qty').addEventListener('input', function () {
        const min = MODEL_MIN_QTY[selectedModel] || 1;
        if (parseInt(this.value) < min) this.value = min;
        updatePricePreview();
    });
    document.getElementById('qty-plus').addEventListener('click', function () {
        const el = document.getElementById('input-qty');
        el.value = Math.min(999, parseInt(el.value || 1) + 1);
        updatePricePreview();
    });
    document.getElementById('qty-minus').addEventListener('click', function () {
        const el = document.getElementById('input-qty');
        const min = MODEL_MIN_QTY[selectedModel] || 1;
        el.value = Math.max(min, parseInt(el.value || min) - 1);
        updatePricePreview();
    });

    // SINGLE REQUEST FORM
    document.getElementById('req-form').addEventListener('submit', function (e) {
        e.preventDefault();
        const pid = parseInt(document.getElementById('input-product').value);
        const email = document.getElementById('input-email').value.trim();
        const qty = Math.max(1, parseInt(document.getElementById('input-qty').value) || 1);

        if (!pid) { showToast('لطفاً محصول را انتخاب کنید.', 'err'); return; }
        if (!email) { showToast('لطفاً ایمیل اکانت را وارد کنید.', 'err'); return; }

        const prod = pmap[pid];
        if (!prod) { showToast('محصول پیدا نشد.', 'err'); return; }

        const unitPrice = prod.price || 0;
        const disc = getB2bDiscount(qty);
        const subtotal = unitPrice * qty;
        let discAmt = 0;
        let totalPrice = subtotal;
        if (disc.type === 'fixed') {
            discAmt = disc.amountRial * qty;
            totalPrice = subtotal - discAmt;
        } else if (disc.type === 'percent' || disc.type === 'invoice') {
            discAmt = Math.round(subtotal * disc.pct / 100);
            totalPrice = subtotal - discAmt;
        }

        const amountStr = unitPrice
            ? toToman(totalPrice) + ' تومان'
            : 'در حال بررسی';

        pending = {
            id: 'REQ-' + Date.now(),
            product_id: prod.id,
            product: prod.name,
            price: unitPrice,
            email: email,
            acc_pass: document.getElementById('input-acc-pass').value,
            email_pass: document.getElementById('input-email-pass').value,
            quantity: qty,
            discountPct: disc,
            totalPrice: totalPrice,
            date: new Date().toLocaleDateString('fa-IR'),
            status: 'PENDING',
            amount: amountStr
        };

        const discRow = (disc.type !== 'none' && discAmt > 0)
            ? `<div class="cfm-row">
                <span class="cl">تخفیف سازمانی</span>
                <span class="cv" style="color:var(--green)">
                    <span class="pp-disc-badge">${disc.label}</span>
                    <span class="pp-disc-amt"> −${toToman(discAmt)} تومان</span>
                </span>
               </div>`
            : '';

        const unitRow = unitPrice
            ? `<div class="cfm-row"><span class="cl">قیمت واحد</span><span class="cv">${toToman(unitPrice)} تومان</span></div>`
            : '';

        const emailRowLabel = qty > 1 ? 'ایمیل نماینده' : 'ایمیل اکانت';
        const qtyLabel = qty > 1 ? `${qty} نفر` : '۱ عدد';
        const orgNote = qty > 1 ? document.getElementById('input-org-note').value.trim() : '';
        const noteRow = orgNote
            ? `<div class="cfm-row"><span class="cl">یادداشت</span><span class="cv">${orgNote}</span></div>`
            : '';

        document.getElementById('cfm-detail').innerHTML = `
            <div class="cfm-row"><span class="cl">محصول</span><span class="cv">${prod.name}</span></div>
            <div class="cfm-row"><span class="cl">تعداد</span><span class="cv">${qtyLabel}</span></div>
            ${unitRow}
            ${discRow}
            <div class="cfm-row"><span class="cl">مبلغ کل</span><span class="cv" style="color:var(--amber-dark);font-size:15px">${amountStr}</span></div>
            <div class="cfm-row"><span class="cl">${emailRowLabel}</span><span class="cv" style="direction:ltr">${email}</span></div>
            ${noteRow}
            <div class="cfm-row"><span class="cl">تاریخ</span><span class="cv">${pending.date}</span></div>
            <div class="cfm-row"><span class="cl">وضعیت اولیه</span><span class="cv"><span class="sbadge s-PENDING">در حال بررسی</span></span></div>
        `;
        const box = document.getElementById('cfm-box');
        box.classList.remove('hid');
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    // CONFIRM & SAVE
    document.getElementById('cfm-btn').addEventListener('click', function () {
        if (!pending) return;
        this.disabled = true;
        this.textContent = 'در حال ثبت...';
        setTimeout(() => {
            requests.unshift(pending);
            localStorage.setItem('nb_reqs', JSON.stringify(requests));
            pending = null;
            document.getElementById('req-form').reset();
            document.getElementById('input-qty').value = 1;
            document.getElementById('qty-fsec').classList.add('hid');
            document.getElementById('price-preview').classList.add('hid');
            document.getElementById('input-product').innerHTML = '<option value="">ابتدا دسته بندی را انتخاب کنید</option>';
            document.getElementById('cfm-box').classList.add('hid');
            document.getElementById('dz-content').innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"/></svg>
                <p><strong>کلیک کنید</strong> یا فایل را اینجا رها کنید</p>
                <small>XLSX، CSV، PDF، JPG (حداکثر ۱۰MB)</small>
            `;
            this.disabled = false;
            this.textContent = 'تأیید و ثبت درخواست';
            showToast('درخواست با موفقیت ثبت شد.');
            renderDash();
            renderTable();
            switchTab('request-list');
        }, 850);
    });

    document.getElementById('back-btn').addEventListener('click', function () {
        document.getElementById('cfm-box').classList.add('hid');
        pending = null;
    });

    // DASHBOARD
    function renderDash() {
        document.getElementById('stat-total').textContent = requests.length;
        document.getElementById('stat-pending').textContent = requests.filter(r => r.status === 'PENDING').length;
        document.getElementById('stat-executing').textContent = requests.filter(r => r.status === 'EXECUTING').length;
        document.getElementById('stat-completed').textContent = requests.filter(r => r.status === 'COMPLETED').length;
        const cnt = document.getElementById('recent-cnt');
        if (!cnt) return;
        if (requests.length === 0) {
            cnt.innerHTML = `<div class="empty-st"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.911a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661z"/></svg><p>هنوز درخواستی ثبت نشده است.</p></div>`;
            return;
        }
        cnt.innerHTML = requests.slice(0, 5).map(r => `
            <div class="ri">
                <div>
                    <div class="ri-prod">${r.product}</div>
                    <div class="ri-id">${r.id}</div>
                </div>
                <span class="sbadge s-${r.status}">${STATUS[r.status] || r.status}</span>
            </div>
        `).join('');
    }

    // TABLE
    function renderTable(search = '') {
        const tbody = document.getElementById('tbl-body');
        if (!tbody) return;
        const s = search.toLowerCase();
        const filtered = requests.filter(r =>
            r.id.toLowerCase().includes(s) ||
            r.product.toLowerCase().includes(s) ||
            r.email.toLowerCase().includes(s)
        );
        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text-muted);">رکوردی وجود ندارد.</td></tr>`;
            return;
        }
        tbody.innerHTML = filtered.map(r => `
            <tr>
                <td class="idc">${r.id}</td>
                <td class="pc">${r.product}${r.quantity > 1 ? `<span class="qty">(${r.quantity} عدد)</span>` : ''}</td>
                <td style="direction:ltr;text-align:left;">${r.email}</td>
                <td>${r.date}</td>
                <td class="amc">${r.amount}</td>
                <td><span class="sbadge s-${r.status}">${STATUS[r.status] || r.status}</span></td>
                <td style="text-align:center">
                    <button class="abtn" title="جزئیات">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/>
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                        </svg>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // SEARCH
    document.getElementById('search-input').addEventListener('input', function () { renderTable(this.value); });

    // DROPZONE
    const dz = document.getElementById('dropzone');
    const fu = document.getElementById('file-upload');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dg'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dg'));
    dz.addEventListener('drop', e => {
        e.preventDefault(); dz.classList.remove('dg');
        if (e.dataTransfer.files[0]) setDz(e.dataTransfer.files[0].name);
    });
    fu.addEventListener('change', function () { if (this.files[0]) setDz(this.files[0].name); });
    function setDz(name) {
        document.getElementById('dz-content').innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="color:#059669;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <p><strong>${name}</strong></p>
            <small>فایل انتخاب شد ✓</small>
        `;
    }

    // DOWNLOAD TEMPLATE
    function downloadTemplate() {
        // Build template with real product IDs from API
        const rows = [
            ...(CATS.products.slice(0, 2).map(p => `${p.id},user@company.com,1`)),
            ...(CATS.practical.slice(0, 1).map(p => `${p.id},user@company.com,2`)),
            ...(CATS.intelligence.slice(0, 1).map(p => `${p.id},user@company.com,1`)),
        ].join('\n');
        const csv = 'product_id,email,quantity\n' + rows;
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'numberland-bulk-template.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    // INIT — load products from API then render
    (async function () {
        await loadProducts();
        renderDash();
        renderTable();
    })();
}
