// =========================================================================
// MealFlow v23.0 — 結構化多語系核心模組 (zh-TW / en / ja / ko)
// 四-2：移除全域 MutationObserver 暴力字串覆寫，改採精確字典查詢、結構化介面翻譯與後端錯誤訊息翻譯
// =========================================================================

function getCurrentAppLang() {
  try {
    if (typeof state !== 'undefined' && state && state.lang) return state.lang;
    return localStorage.getItem('mealflow_lang') || 'zh-TW';
  } catch (e) {
    return 'zh-TW';
  }
}

function t(zhText, enText, jaText, koText) {
  const lang = getCurrentAppLang();
  if (lang === 'en') return enText !== undefined ? enText : zhText;
  if (lang === 'ja') return jaText !== undefined ? jaText : (enText !== undefined ? enText : zhText);
  if (lang === 'ko') return koText !== undefined ? koText : (enText !== undefined ? enText : zhText);
  return zhText;
}

// 精確詞彙對照字典（校區、店家、分類、規格、狀態、支付方式）
const I18N_DICTIONARY = {
  '雙溪校區': { en: 'Waishuangxi Campus', ja: '双渓キャンパス', ko: '솽시 캠퍼스' },
  '城中校區': { en: 'Downtown Campus', ja: '城中キャンパス', ko: '청중 캠퍼스' },
  '趙班長海苔飯捲': { en: "Capt. Zhao's Kimbap", ja: '趙班長キンパ', ko: '조반장 김밥' },
  '雙溪-丼物園': { en: 'Donburi Garden', ja: '丼物園', ko: '돈부리 가든' },
  '丼物園': { en: 'Donburi Garden', ja: '丼物園', ko: '돈부리 가든' },
  '雙溪-四海遊龍': { en: 'Sihai Youlong Dumplings', ja: '四海遊龍（餃子）', ko: '스하이요우룽 만두' },
  '四海遊龍': { en: 'Sihai Youlong Dumplings', ja: '四海遊龍（餃子）', ko: '스하이요우룽 만두' },
  '蒲家廚房': { en: 'Pu Family Kitchen', ja: '蒲家キッチン', ko: '푸가 키친' },
  '城中-咖哩食堂': { en: 'Curry House', ja: 'カレー食堂', ko: '카레 식당' },
  '咖哩食堂': { en: 'Curry House', ja: 'カレー食堂', ko: '카레 식당' },
  '城中-吳葉食堂': { en: 'Wuye Bento & Grill', ja: '呉葉食堂', ko: '우예 식당' },
  '林娘食堂': { en: "Lin's Noodle Kitchen", ja: '林娘食堂', ko: '린냥 식당' },
  '海音咖啡': { en: 'Haiyin Cafe', ja: '海音カフェ', ko: '하이인 카페' },
  '奕香咖啡': { en: 'Yixiang Coffee', ja: '奕香コーヒー', ko: '이샹 커피' },
  '夠健康廚房': { en: 'Go Healthy Kitchen', ja: 'ヘルシーキッチン', ko: '고 헬시 키친' },
  '醬心獨辣': { en: 'Spicy Malatang & Braised', ja: '醤心麻辣湯', ko: '마라탕・루웨이' },
  '醬心獨辣麻辣燙': { en: 'Spicy Malatang & Braised', ja: '醤心麻辣湯', ko: '마라탕・루웨이' },
  '東吳涼麵': { en: 'SCU Cold Noodles', ja: '東呉冷麺', ko: '둥우 냉면' },
  '拉手-捲鑫酥': { en: 'Crispy Wraps & Bakery', ja: 'ラショウ・ラップサンド', ko: '크리스피 랩・베이커리' },
  '大熊涼麵 X 吃好食堂': { en: 'Big Bear Cold Noodles', ja: '大熊冷麺食堂', ko: '빅베어 냉면' },
  '人氣韓式・飯捲': { en: 'Korean Kimbap & Rolls', ja: '韓国キンパ・海苔巻き', ko: '김밥・한식' },
  '人氣飯捲・抓餅輕食': { en: 'Kimbap & Crispy Pancakes', ja: 'キンパ・ネギパイ軽食', ko: '김밥・총좌빙' },
  '日式蓋飯・烏龍麵': { en: 'Donburi & Udon', ja: '丼・うどん', ko: '덮밥・우동' },
  '日式丼飯・咖哩定食': { en: 'Japanese Donburi & Curry', ja: '和風丼・カレー定食', ko: '일본 덮밥・카레' },
  '鍋貼水餃・麵食': { en: 'Potstickers & Dumplings', ja: '焼餃子・水餃子', ko: '군만두・물만두' },
  '中式特餐・便當': { en: 'Signature Bento', ja: '中華弁当', ko: '중식 도시락' },
  '熟成咖哩・炸物': { en: 'Aged Curry & Cutlets', ja: '熟成カレー・揚げ物', ko: '숙성 카레・돈카츠' },
  '風味咖哩・特色蓋飯': { en: 'Curry & Rice Bowls', ja: '風味カレー・丼ぶり', ko: '카레・덮밥' },
  '台式麵食・手工餃': { en: 'Taiwanese Noodles & Dumplings', ja: '台湾麺・手作り餃子', ko: '대만 면・수제 만두' },
  '港式便當・秘製涼麵': { en: 'HK Bento & Cold Noodles', ja: '香港弁当・特製冷麺', ko: '홍콩 도시락・냉면' },
  '特調飲品・手作輕食': { en: 'Craft Drinks & Light Bites', ja: '特製ドリンク・軽食', ko: '음료・가벼운 식사' },
  '特調咖啡・輕食簡餐': { en: 'Specialty Coffee & Meals', ja: '特製コーヒー・軽食', ko: '스페셜티 커피・식사' },
  '健康廚房・低GI餐盒': { en: 'Low-GI Healthy Bento', ja: '低GIヘルシー弁当', ko: '저혈당 건강 도시락' },
  '麻辣燙・乾拌滷味': { en: 'Malatang & Braised Dishes', ja: '麻辣湯・台湾煮込み', ko: '마라탕・루웨이' },
  '招牌涼麵・各式熱麵': { en: 'Cold & Hot Noodles', ja: '名物冷麺・温かい麺', ko: '냉면・온면' },
  '酥脆捲餅・法式麵包': { en: 'Crispy Wraps & French Bread', ja: 'サクサク巻餅・フランスパン', ko: '바삭한 랩・바게트' },
  '精緻台式簡餐': { en: 'Taiwanese Set Meals', ja: '台湾定食', ko: '대만 정식' },
  '手工涼麵・味噌湯': { en: 'Cold Noodles & Miso Soup', ja: '手打ち冷麺・味噌汁', ko: '냉면・미소국' },
  '韓式海苔飯捲': { en: 'Korean Kimbap Rolls', ja: '韓国海苔巻き', ko: '김밥류' },
  '韓式湯品與飲品': { en: 'Soups & Drinks', ja: 'スープ・ドリンク', ko: '국・음료' },
  '炙燒日式丼飯': { en: 'Flame-Seared Donburi', ja: '炙り丼', ko: '직화 덮밥' },
  '讚岐烏龍麵': { en: 'Sanuki Udon', ja: '讃岐うどん', ko: '사누키 우동' },
  '單點炸物與茶飲': { en: 'Fried Sides & Tea', ja: '揚げ物・お茶', ko: '튀김・차' },
  '手工鍋貼與水餃': { en: 'Potstickers & Dumplings', ja: '手作り餃子', ko: '수제 만두' },
  '開胃小菜與湯飲': { en: 'Sides, Soups & Drinks', ja: '小鉢・スープ', ko: '반찬・국・음료' },
  '人氣特餐便當': { en: 'Signature Bento Box', ja: '人気弁当', ko: '인기 도시락' },
  '單點小菜與湯品': { en: 'Side Dishes & Soups', ja: 'サイド・スープ', ko: '사이드・국' },
  '熟成濃咖哩': { en: 'Rich Aged Curry', ja: '熟成濃厚カレー', ko: '숙성 진한 카레' },
  '炸物點心': { en: 'Fried Snacks', ja: '揚げ物スナック', ko: '튀김류' },
  '主廚鐵板與簡餐': { en: 'Teppanyaki & Sets', ja: '鉄板焼き定食', ko: '철판 정식' },
  '特色麵食': { en: 'Specialty Noodles', ja: '特製麺', ko: '특선 면류' },
  '手工現拌涼麵': { en: 'Handmade Cold Noodles', ja: '特製冷麺', ko: '수제 냉면' },
  '招牌味噌湯品': { en: 'Signature Miso Soup', ja: '特製味噌汁', ko: '미소국' },
  '招牌主餐': { en: 'Signature Mains', ja: '看板メニュー', ko: '대표 메뉴' },
  '丼飯(3菜)': { en: 'Donburi (3 Sides)', ja: '丼ぶり（副菜3品付）', ko: '덮밥 (반찬 3종)' },
  '咖哩(3菜)': { en: 'Curry Rice (3 Sides)', ja: 'カレー（副菜3品付）', ko: '카레 (반찬 3종)' },
  '定食(3菜)': { en: 'Set Meal (3 Sides)', ja: '定食（副菜3品付）', ko: '정식 (반찬 3종)' },
  '單點': { en: 'À La Carte', ja: '単品', ko: '단품' },
  '抓餅類': { en: 'Scallion Pancakes', ja: '台湾風ネギパイ', ko: '총좌빙' },
  '飯捲類': { en: 'Rice Rolls', ja: 'ライスロール', ko: '라이스롤' },
  '主食份量': { en: 'Rice Portion', ja: 'ご飯の量', ko: '밥 양' },
  '正常飯量': { en: 'Regular Rice', ja: '普通盛り', ko: '보통' },
  '飯少(減醣)': { en: 'Less Rice', ja: '少なめ', ko: '밥 적게' },
  '大盛加飯': { en: 'Extra Rice', ja: '大盛り', ko: '밥 추가' },
  '辣度選擇': { en: 'Spice Level', ja: '辛さ選択', ko: '맵기 선택' },
  '不辣': { en: 'Non-Spicy', ja: '辛さなし', ko: '안 맵게' },
  '微辣': { en: 'Mild Spicy', ja: '微辛', ko: '약간 맵게' },
  '小辣': { en: 'Medium Spicy', ja: '小辛', ko: '덜 맵게' },
  '中辣': { en: 'Spicy', ja: '中辛', ko: '중간 매운맛' },
  '大辣': { en: 'Extra Hot', ja: '大辛', ko: '아주 맵게' },
  '人氣加料': { en: 'Add-ons', ja: 'トッピング', ko: '토핑 추가' },
  '加香濃起司': { en: 'Add Cheese', ja: 'チーズ追加', ko: '치즈 추가' },
  '加溏心溫泉蛋': { en: 'Add Onsen Egg', ja: '温泉卵追加', ko: '온천계란 추가' },
  '不要蔥花/香菜': { en: 'No Scallions/Cilantro', ja: 'ネギ・パクチー抜き', ko: '파/고수 빼기' },
  '麵條份量': { en: 'Noodle Portion', ja: '麺の量', ko: '면 양' },
  '標準份量': { en: 'Regular Noodles', ja: '普通', ko: '보통' },
  '加麵大碗': { en: 'Extra Noodles', ja: '麺大盛り', ko: '면 추가' },
  '單點加料': { en: 'Add-ons', ja: '追加トッピング', ko: '추가 토핑' },
  '加滷蛋': { en: 'Add Braised Egg', ja: '煮卵追加', ko: '간장계란 추가' },
  '加貢丸(2顆)': { en: 'Add 2 Pork Balls', ja: '肉団子2個追加', ko: '완자 2알 추가' },
  '不要蔥花': { en: 'No Scallions', ja: 'ネギ抜き', ko: '파 빼기' },
  '甜度調整': { en: 'Sweetness', ja: '甘さ', ko: '당도' },
  '冰塊調整': { en: 'Ice Level', ja: '氷の量', ko: '얼음량' },
  '甜度': { en: 'Sweetness', ja: '甘さ', ko: '당도' },
  '冰塊': { en: 'Ice Level', ja: '氷', ko: '얼음' },
  '正常甜': { en: 'Regular Sugar', ja: '通常の甘さ', ko: '기본 당도' },
  '少糖': { en: 'Less Sugar', ja: '甘さ控えめ', ko: '덜 달게' },
  '微糖': { en: 'Light Sugar', ja: '微糖', ko: '약간 달게' },
  '無糖': { en: 'Unsweetened', ja: '無糖', ko: '무가당' },
  '正常冰': { en: 'Regular Ice', ja: '氷普通', ko: '얼음 보통' },
  '少冰': { en: 'Less Ice', ja: '氷少なめ', ko: '얼음 적게' },
  '微冰': { en: 'Light Ice', ja: '微氷', ko: '얼음 아주 적게' },
  '去冰': { en: 'No Ice', ja: '氷なし', ko: '얼음 빼기' },
  '溫熱': { en: 'Warm / Hot', ja: 'ホット', ko: '따뜻하게' },
  '套餐附餐飲料': { en: 'Combo Drink', ja: 'セットドリンク', ko: '세트 음료' },
  '招牌紅茶': { en: 'Iced Black Tea', ja: '特製紅茶', ko: '아이스 홍차' },
  '四季青茶': { en: 'Four Seasons Oolong', ja: '四季春茶', ko: '사계절 우롱차' },
  '鮮奶茶': { en: 'Fresh Milk Tea', ja: 'ミルクティー', ko: '밀크티' },
  '不需飲料': { en: 'No Drink', ja: 'ドリンク不要', ko: '음료 없음' },
  '外帶自取': { en: 'Takeout Pickup', ja: 'テイクアウト', ko: '포장 픽업' },
  '內用自取': { en: 'Dine-in', ja: '店内飲食', ko: '매장 식사' },
  '製作中': { en: 'Preparing', ja: '調理中', ko: '조리 중' },
  '可取餐': { en: 'Ready for Pickup', ja: '受取可能', ko: '픽업 가능' },
  '已接單待排程': { en: 'Scheduled', ja: '予約受付済', ko: '예약 접수됨' },
  '待付款確認': { en: 'Pending Payment', ja: 'お支払い待ち', ko: '결제 대기' },
  '已完成': { en: 'Completed', ja: '完了', ko: '완료' },
  '已付款': { en: 'Paid', ja: '支払済', ko: '결제 완료' },
  '內用餐後結帳': { en: 'Pay After Meal', ja: '食後会計', ko: '식후 결제' },
  '尚有加點待補款': { en: 'Add-on Balance Due', ja: '追加注文未払い', ko: '추가 주문 미결제' },
  '取餐付現': { en: 'Cash at Pickup', ja: '受取時現金', ko: '픽업 시 현금' },
  '現場櫃檯付現': { en: 'Cash at Counter', ja: '店頭現金', ko: '카운터 현금' },
  '現場現金': { en: 'Cash', ja: '現金', ko: '현금' },
  '全部': { en: 'All', ja: 'すべて', ko: '전체' },
  '早班': { en: 'Morning Shift', ja: '早番', ko: '오전 근무' },
  '晚班': { en: 'Evening Shift', ja: '遅番', ko: '오후 근무' },
  '全日': { en: 'Full Day', ja: '終日', ko: '종일' }
};

// 後端回傳之系統錯誤與狀態訊息精準多語翻譯（不破壞原字串參數）
const SERVER_ERROR_PATTERNS = [
  [/^找不到該筆訂單[:：]\s*(.+)$/, (m) => t(m[0], `Order not found: ${m[1]}`, `注文が見つかりません: ${m[1]}`, `주문을 찾을 수 없습니다: ${m[1]}`)],
  [/核銷碼驗證失敗/, () => t('核銷碼驗證失敗，請確認 6 碼取餐核銷碼後再試', 'Invalid 6-char verification code. Please check and try again.', '認証コードが一致しません。6桁のコードをご確認ください。', '인증 코드가 일치하지 않습니다. 6자리 코드를 확인해 주세요.')],
  [/訂單已進入廚房備餐或完成階段/, () => t('訂單已進入廚房備餐或完成階段，無法由線上自助取消，請洽詢店家櫃檯處理。', 'This order is already preparing or completed and cannot be self-cancelled. Please contact the counter.', 'すでに調理中または完了しているためキャンセルできません。店頭へご相談ください。', '이미 조리 중이거나 완료된 주문은 온라인 취소가 불가합니다. 카운터에 문의하세요.')],
  [/本店尚未設定真實 LINE Pay 商家金鑰/, () => t('本店尚未設定真實 LINE Pay 商家金鑰，請改用「現場取餐付現」或洽店長設定。', 'LINE Pay is not configured for this store yet. Please pay cash at pickup.', 'この店舗はLINE Pay未設定です。店頭現金払いをご利用ください。', '이 매장은 LINE Pay가 설정되지 않았습니다. 현장 현금 결제를 이용해 주세요.')],
  [/尚未完成付款確認/, () => t('此訂單尚未完成付款確認，請先收款後再核銷交付', 'Payment not settled yet. Please collect payment first.', 'まだお支払いが完了していません。先に会計を完了してください。', '결제가 완료되지 않았습니다. 먼저 결제 후 완료 처리하세요.')],
  [/此操作需店長授權|需店長權限/, () => t('此操作需店長權限，請輸入店長 PIN 覆核授權', 'Manager approval required. Please enter the Manager PIN.', '店長権限が必要です。店長PINを入力してください。', '점장 권한이 필요합니다. 점장 PIN을 입력해 주세요.')],
  [/店長覆核 PIN 碼錯誤/, () => t('店長覆核 PIN 碼錯誤', 'Incorrect Manager override PIN.', '店長PINが正しくありません。', '점장 승인 PIN이 올바르지 않습니다.')],
  [/權限驗證失敗|請重新輸入.*PIN/, () => t('店務權限已失效，請重新輸入授權碼', 'Merchant session expired. Please re-enter store PIN.', '店舗認証が期限切れです。PINを再入力してください。', '매장 인증이 만료되었습니다. PIN을 다시 입력해 주세요.')],
  [/已達本日限量上限|目前已售罄/, (m) => t(m[0], `Item sold out or reached daily limit (${m[0]})`, `売切れまたは1日限定数に達しました (${m[0]})`, `품절되었거나 일일 한정 수량에 도달했습니다 (${m[0]})`)],
  [/優惠券無效|未達優惠券低消/, (m) => t(m[0], `Coupon invalid or minimum spend not met (${m[0]})`, `クーポン無効または最低利用金額未満です (${m[0]})`, `쿠폰이 유효하지 않거나 최소 주문 금액 미만입니다 (${m[0]})`)]
];

function translateServerError(rawMsg) {
  const s = String(rawMsg || '').trim();
  const lang = getCurrentAppLang();
  if (!s || lang === 'zh-TW') return s;
  for (let i = 0; i < SERVER_ERROR_PATTERNS.length; i++) {
    const [re, fn] = SERVER_ERROR_PATTERNS[i];
    const m = s.match(re);
    if (m) return fn(m);
  }
  return s;
}

function trTerm(rawStr) {
  const s = String(rawStr || '').trim();
  const lang = getCurrentAppLang();
  if (!s || lang === 'zh-TW') return s;
  const exact = I18N_DICTIONARY[s];
  if (exact) {
    return typeof exact === 'string' ? exact : (exact[lang] || exact.en || s);
  }
  // 支援「加起司 ×2」類型的數量綴詞翻譯
  const qtyMatch = s.match(/^(.+?)\s*([×x]\s*\d+)$/i);
  if (qtyMatch && I18N_DICTIONARY[qtyMatch[1].trim()]) {
    const baseEntry = I18N_DICTIONARY[qtyMatch[1].trim()];
    const baseTranslated = typeof baseEntry === 'string' ? baseEntry : (baseEntry[lang] || baseEntry.en || qtyMatch[1]);
    return `${baseTranslated} ${qtyMatch[2].replace(/\s+/g, '')}`;
  }
  // 常見推薦標籤微調
  if (s.includes('🔥')) return s.replace('必點人氣', t('必點人氣', 'Popular', '人気', '인기')).replace('店長推薦', t('店長推薦', "Chef's Pick", '店長おすすめ', '추천')).replace('招牌必點', t('招牌必點', 'Signature', '看板メニュー', '시그니처')).replace('銷量冠軍', t('銷量冠軍', 'Best Seller', '人気No.1', '베스트')).replace('現點現做', t('現點現做', 'Made to Order', '作りたて', '즉시 조리'));
  if (s.includes('⭐')) return s.replace('主廚推薦', t('主廚推薦', "Chef's Special", 'おすすめ', '셰프 추천')).replace('飽足首選', t('飽足首選', 'Hearty Choice', '満腹メニュー', '든든한 메뉴')).replace('限量供應', t('限量供應', 'Limited', '数量限定', '한정 수량')).replace('學生最愛', t('學生最愛', 'Student Pick', '学生人気', '학생 인기'));
  if (s.includes('⚡')) return s.replace('快速出餐', t('快速出餐', 'Express', 'スピード', '빠른 제공')).replace('極速出餐', t('極速出餐', 'Express', 'スピード', '빠른 제공')).replace('極速便當', t('極速便當', 'Fast Bento', 'スピード弁当', '빠른 도시락'));
  return s;
}

function trDishName(item) {
  if (!item) return '';
  const lang = getCurrentAppLang();
  if (lang !== 'zh-TW' && item.nameEn && String(item.nameEn).trim()) {
    return String(item.nameEn).trim();
  }
  return String(item.baseName || item.name || '');
}

// 結構化更新靜態 HTML 標籤（取代舊版全域 MutationObserver）
function syncHeaderLanguageControls() {
  const lang = getCurrentAppLang();
  const sel = document.getElementById('headerLangSelect');
  if (sel && sel.value !== lang) sel.value = lang;
  const legacyBtn = document.getElementById('headerLangToggleBtn');
  if (legacyBtn) {
    const labelMap = { 'zh-TW': '🌐 繁中', 'en': '🌐 EN', 'ja': '🌐 日本語', 'ko': '🌐 한국어' };
    legacyBtn.innerText = labelMap[lang] || '🌐 繁中';
  }

  const staticTextMap = {
    'filter-ALL': t('全部櫃位', 'All', 'すべて', '전체'),
    'filter-FAST': t('免排隊', 'Fast', '待ちなし', '빠른 픽업'),
    'filter-PROMO': t('優惠', 'Deals', '割引', '할인'),
    'btnOpenOrderLookup': t('🔍 查單', '🔍 Lookup', '🔍 照会', '🔍 조회'),
    'btnOpenAiAdvisor': t('✨ 選餐助手', '✨ Advisor', '✨ おすすめ', '✨ 추천'),
    'campusBtn-雙溪校區': `⛰️ ${t('雙溪校區', 'Waishuangxi', '双渓', '솽시')}`,
    'campusBtn-城中校區': `🏙️ ${t('城中校區', 'Downtown', '城中', '청중')}`,
    'headerLineNotifyBtnText': t('綁定通知', 'Alerts', '通知連携', '알림 연동'),
    'cartSubmitBtn': t('確認送出訂單', 'Place Order', '注文を確定', '주문하기')
  };
  Object.entries(staticTextMap).forEach(([id, txt]) => {
    const el = document.getElementById(id);
    if (el) el.innerText = txt;
  });

  const lineBtn = document.getElementById('headerLineBindBtn');
  if (lineBtn && !lineBtn.classList.contains('line-bound-active')) {
    const hasCustomText = document.getElementById('headerLineNotifyBtnText');
    if (!hasCustomText) {
      lineBtn.innerText = `🔔 ${t('通知', 'Alerts', '通知', '알림')}`;
    }
  }

  const myOrdersBtn = document.getElementById('headerMyOrdersBtn');
  if (myOrdersBtn) {
    const labelSpan = myOrdersBtn.querySelector ? myOrdersBtn.querySelector('span:first-child') : null;
    if (labelSpan) labelSpan.innerText = `🧾 ${t('我的訂單', 'Orders', '注文履歴', '주문내역')}`;
  }

  const railLabels = {
    'railBtn-pos': t('點餐', 'POS', 'レジ', '포스'),
    'railBtn-kds': t('訂單', 'Orders', '注文', '주문'),
    'railBtn-analytics': t('分析', 'Stats', '分析', '분석'),
    'railBtn-settings': t('設定', 'Settings', '設定', '설정')
  };
  Object.entries(railLabels).forEach(([id, lbl]) => {
    const btn = document.getElementById(id);
    if (btn && btn.querySelectorAll) {
      const spans = btn.querySelectorAll('span');
      if (spans[1]) spans[1].innerText = lbl;
    }
  });

  // 同步所有帶有 data-i18n-en / data-i18n-zh 的靜態元素
  if (typeof document !== 'undefined' && document.querySelectorAll) {
    document.querySelectorAll('[data-i18n-zh]').forEach((el) => {
      const zh = el.getAttribute('data-i18n-zh') || '';
      const en = el.getAttribute('data-i18n-en') || zh;
      const ja = el.getAttribute('data-i18n-ja') || en;
      const ko = el.getAttribute('data-i18n-ko') || en;
      el.innerText = t(zh, en, ja, ko);
    });
  }
}

// 保留相容空殼，避免任何舊呼叫點報錯
function applyDomSystemTranslation() {
  syncHeaderLanguageControls();
}

function setAppLanguage(nextLang) {
  const allowed = ['zh-TW', 'en', 'ja', 'ko'];
  if (typeof state !== 'undefined' && state) {
    state.lang = allowed.includes(nextLang) ? nextLang : 'zh-TW';
  }
  try { localStorage.setItem('mealflow_lang', allowed.includes(nextLang) ? nextLang : 'zh-TW'); } catch (e) {}
  syncHeaderLanguageControls();
  if (typeof applyRouteView === 'function') applyRouteView();
  if (typeof updateCartUI === 'function') updateCartUI();
  const curLang = getCurrentAppLang();
  const msgMap = {
    'zh-TW': '🌐 已切換為繁體中文介面',
    'en': '🌐 Switched to English interface',
    'ja': '🌐 日本語インターフェースに切り替えました',
    'ko': '🌐 한국어 인터페이스로 변경되었습니다'
  };
  if (typeof showToast === 'function') showToast(msgMap[curLang] || msgMap['zh-TW']);
}

function toggleAppLanguage() {
  const order = ['zh-TW', 'en', 'ja', 'ko'];
  const idx = order.indexOf(getCurrentAppLang());
  setAppLanguage(order[(idx + 1) % order.length]);
}
