// =========================================================================
// MealFlow v25.0 — 結構化 4 語系精準翻譯核心引擎 (zh-TW / en / ja / ko)
// 徹底移除貪婪子字串切碎替換，僅採結構化 t() + 整句精確查表 + 完整樣式比對，零中英夾雜！
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

// 1. 精確詞彙對照字典（校區、店家、分類、規格、狀態、支付方式與核心介面詞彙）
const I18N_DICTIONARY = {
  // 校區與預設店家
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
  '醬心獨辣麻辣燙': { en: 'Spicy Malatang & Braised', ja: '醤心麻辣湯', ko: '마라탕・루웨이' },
  '醬心獨辣': { en: 'Spicy Malatang & Braised', ja: '醤心麻辣湯', ko: '마라탕・루웨이' },
  '東吳涼麵': { en: 'SCU Cold Noodles', ja: '東呉冷麺', ko: '둥우 냉면' },
  '拉手-捲鑫酥': { en: 'Crispy Wraps & Bakery', ja: 'ラショウ・ラップサンド', ko: '크리스피 랩・베이커리' },
  '大熊涼麵 X 吃好食堂': { en: 'Big Bear Cold Noodles', ja: '大熊冷麺食堂', ko: '빅베어 냉면' },

  // 餐廳與菜單分類
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
  '招牌推薦': { en: 'Recommended', ja: 'おすすめ', ko: '추천 메뉴' },
  '丼飯(3菜)': { en: 'Donburi (3 Sides)', ja: '丼ぶり（副菜3品付）', ko: '덮밥 (반찬 3종)' },
  '咖哩(3菜)': { en: 'Curry Rice (3 Sides)', ja: 'カレー（副菜3品付）', ko: '카레 (반찬 3종)' },
  '定食(3菜)': { en: 'Set Meal (3 Sides)', ja: '定食（副菜3品付）', ko: '정식 (반찬 3종)' },
  '單點': { en: 'À La Carte', ja: '単品', ko: '단품' },
  '抓餅類': { en: 'Scallion Pancakes', ja: '台湾風ネギパイ', ko: '총좌빙' },
  '蔥抓餅類': { en: 'Scallion Pancakes', ja: '台湾風ネギパイ', ko: '총좌빙' },
  '飯捲類': { en: 'Rice Rolls', ja: 'ライスロール', ko: '라이스롤' },
  '酥炸類': { en: 'Crispy Fried', ja: '揚げ物', ko: '바삭 튀김류' },
  '炸物類': { en: 'Fried Snacks', ja: '揚げ物', ko: '튀김류' },
  '點心類': { en: 'Snacks', ja: '軽食・スナック', ko: '간식류' },
  '湯品類': { en: 'Soups', ja: 'スープ', ko: '국물류' },
  '飲品類': { en: 'Drinks', ja: 'ドリンク', ko: '음료류' },
  '飲料類': { en: 'Drinks', ja: 'ドリンク', ko: '음료류' },
  '飲料': { en: 'Drinks', ja: 'ドリンク', ko: '음료' },
  '飲品': { en: 'Drinks', ja: 'ドリンク', ko: '음료' },
  '冷飲類': { en: 'Cold Drinks', ja: '冷たいドリンク', ko: '차가운 음료' },
  '熱飲類': { en: 'Hot Drinks', ja: 'ホットドリンク', ko: '따뜻한 음료' },
  '茶飲類': { en: 'Tea Drinks', ja: 'お茶・ティー', ko: '차 음료' },
  '咖啡類': { en: 'Coffee', ja: 'コーヒー', ko: '커피류' },
  '手搖飲': { en: 'Hand-Shaken Drinks', ja: 'ドリンクスタンド', ko: '밀크티・음료' },
  '海苔飯捲類': { en: 'Kimbap Rolls', ja: '海苔巻き', ko: '김밥류' },
  '捲餅類': { en: 'Wraps', ja: 'ラップ・巻餅', ko: '랩・롤' },
  '吐司類': { en: 'Toasts', ja: 'トースト', ko: '토스트류' },
  '漢堡類': { en: 'Burgers', ja: 'ハンバーガー', ko: '버거류' },
  '蛋餅類': { en: 'Egg Crepes', ja: '台湾風蛋餅', ko: '딴빙류' },
  '鐵板麵類': { en: 'Teppanyaki Noodles', ja: '鉄板麺', ko: '철판면류' },
  '套餐類': { en: 'Combo Sets', ja: 'セットメニュー', ko: '세트 메뉴' },
  '特餐類': { en: 'Special Sets', ja: 'スペシャル定食', ko: '특선 세트' },
  '主餐類': { en: 'Mains', ja: 'メイン料理', ko: '메인 메뉴' },
  '主食類': { en: 'Mains', ja: '主食', ko: '주식류' },
  '飯類': { en: 'Rice Dishes', ja: 'ご飯もの', ko: '밥류' },
  '麵類': { en: 'Noodles', ja: '麺類', ko: '면류' },
  '湯類': { en: 'Soups', ja: 'スープ', ko: '국물류' },
  '單點類': { en: 'À La Carte', ja: '単品', ko: '단품류' },
  '加點類': { en: 'Add-ons', ja: '追加メニュー', ko: '추가 메뉴' },
  '加購類': { en: 'Add-ons', ja: '追加購入', ko: '추가 구매' },
  '配餐類': { en: 'Sides', ja: 'サイドメニュー', ko: '사이드 메뉴' },
  '炸雞類': { en: 'Fried Chicken', ja: 'フライドチキン', ko: '치킨류' },
  '烤物類': { en: 'Grilled', ja: '焼き物', ko: '구이류' },
  '滷味類': { en: 'Braised Dishes', ja: '台湾煮込み', ko: '루웨이' },
  '甜品類': { en: 'Desserts', ja: 'デザート', ko: '디저트류' },
  '甜點類': { en: 'Desserts', ja: 'スイーツ', ko: '디저트류' },
  '輕食類': { en: 'Light Bites', ja: '軽食', ko: '가벼운 식사' },
  '早餐類': { en: 'Breakfast', ja: '朝食メニュー', ko: '조식류' },
  '沙拉類': { en: 'Salads', ja: 'サラダ', ko: '샐러드류' },
  '鍋物類': { en: 'Hot Pots', ja: '鍋もの', ko: '전골류' },
  '粥品類': { en: 'Congee', ja: 'お粥', ko: '죽류' },
  '咖哩類': { en: 'Curry', ja: 'カレー', ko: '카레류' },
  '丼飯類': { en: 'Donburi', ja: '丼もの', ko: '덮밥류' },
  '水餃類': { en: 'Dumplings', ja: '水餃子', ko: '물만두류' },
  '鍋貼類': { en: 'Potstickers', ja: '焼き餃子', ko: '군만두류' },
  '涼麵類': { en: 'Cold Noodles', ja: '冷麺', ko: '냉면류' },
  '素食類': { en: 'Vegetarian', ja: 'ベジタリアン', ko: '채식류' },
  '蔬食類': { en: 'Plant-Based', ja: 'プラントベース', ko: '비건/채식' },
  '查看購物車': { en: 'View Cart', ja: 'カートを見る', ko: '장바구니 보기' },
  '購物車': { en: 'Cart', ja: 'カート', ko: '장바구니' },
  '本日售完': { en: 'Sold Out Today', ja: '本日売切', ko: '오늘 품절' },
  '完全售完': { en: 'Out of Stock', ja: '長期品切', ko: '재고 소진' },
  '長期缺貨': { en: 'Out of Stock', ja: '長期品切', ko: '장기 품절' },
  '現場付款': { en: 'Pay at Counter', ja: '店頭払い', ko: '현장 결제' },
  '主廚推薦': { en: "Chef's Specials", ja: 'シェフおすすめ', ko: '셰프 추천' },
  '小菜類': { en: 'Side Dishes', ja: 'サイドメニュー', ko: '반찬류' },
  '便當類': { en: 'Bento Boxes', ja: 'お弁当', ko: '도시락류' },
  '麵食類': { en: 'Noodles', ja: '麺類', ko: '면류' },
  '其他': { en: 'Other', ja: 'その他', ko: '기타' },

  // 餐點標籤
  '🔥 必點人氣': { en: '🔥 Popular', ja: '🔥 人気', ko: '🔥 인기' },
  '⭐ 主廚推薦': { en: "⭐ Chef's Pick", ja: '⭐ おすすめ', ko: '⭐ 셰프 추천' },
  '⚡ 快速出餐': { en: '⚡ Express', ja: '⚡ スピード', ko: '⚡ 빠른 제공' },
  '🥣 暖胃湯品': { en: '🥣 Warm Soup', ja: '🥣 スープ', ko: '🥣 따뜻한 국' },
  '🥤 人氣飲品': { en: '🥤 Popular Drink', ja: '🥤 人気ドリンク', ko: '🥤 인기 음료' },
  '🔥 招牌必點': { en: '🔥 Signature', ja: '🔥 看板メニュー', ko: '🔥 시그니처' },
  '🔥 店長推薦': { en: "🔥 Manager's Pick", ja: '🔥 店長おすすめ', ko: '🔥 점장 추천' },
  '🔥 限定': { en: '🔥 Limited', ja: '🔥 限定', ko: '🔥 한정' },
  '🔥 新上市': { en: '🔥 New', ja: '🔥 新発売', ko: '🔥 신메뉴' },
  '⭐ 限量供應': { en: '⭐ Limited', ja: '⭐ 数量限定', ko: '⭐ 한정 수량' },
  '⭐ 飽足首選': { en: '⭐ Hearty', ja: '⭐ 満腹', ko: '⭐ 든든한 메뉴' },
  '🍗 人氣單點': { en: '🍗 Popular Side', ja: '🍗 人気サイド', ko: '🍗 인기 사이드' },
  '🍵 解膩首選': { en: '🍵 Refreshing Tea', ja: '🍵 さっぱり茶', ko: '🍵 깔끔한 차' },
  '✨ 招牌小菜': { en: '✨ Signature Side', ja: '✨ 看板サイド', ko: '✨ 대표 반찬' },
  '🥛 清涼飲品': { en: '🥛 Cold Drink', ja: '🥛 冷たい飲物', ko: '🥛 시원한 음료' },
  '🌶️ 香辣過癮': { en: '🌶️ Spicy Hit', ja: '🌶️ ピリ辛', ko: '🌶️ 매콤한 맛' },
  '🧀 邪惡點心': { en: '🧀 Crispy Snack', ja: '🧀 スナック', ko: '🧀 바삭 간식' },

  // 餐點規格
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
  '份量選擇': { en: 'Portion Size', ja: 'サイズ選択', ko: '양 선택' },
  '醬料包選擇': { en: 'Sauce Options', ja: 'ソース選択', ko: '소스 선택' },
  '蒜泥醬油膏': { en: 'Garlic Soy Paste', ja: 'ニンニク醤油', ko: '마늘 간장소스' },
  '特製辣椒醬': { en: 'Chili Sauce', ja: '特製チリソース', ko: '특제 칠리소스' },
  '白醋': { en: 'White Vinegar', ja: '白酢', ko: '식초' },
  '免醬料': { en: 'No Sauce', ja: 'ソースなし', ko: '소스 없음' },
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
  '調味粉': { en: 'Seasoning', ja: '味付け', ko: '시즈닝' },
  '原味胡椒': { en: 'Salt & Pepper', ja: '塩コショウ', ko: '소금 후추' },
  '日式七味粉': { en: 'Japanese Shichimi', ja: '七味唐辛子', ko: '시치미' },
  '泰式酸辣醬': { en: 'Thai Sweet Chili', ja: 'タイ風チリソース', ko: '타이 스위트 칠리' },
  '胡椒與醋': { en: 'Pepper & Vinegar', ja: 'コショウ・酢', ko: '후추와 식초' },
  '加辣油': { en: 'Add Chili Oil', ja: 'ラー油追加', ko: '고추기름 추가' },
  '不加蔥香菜': { en: 'No Scallions/Cilantro', ja: 'ネギ・パクチー抜き', ko: '파/고수 빼기' },

  // 訂單狀態、用餐方式、支付方式、班別
  '外帶自取': { en: 'Takeout Pickup', ja: 'テイクアウト', ko: '포장 픽업' },
  '內用自取': { en: 'Dine-in', ja: '店内飲食', ko: '매장 식사' },
  '現場櫃檯付現': { en: 'Cash at Counter', ja: '店頭現金', ko: '카운터 현금' },
  '內用餐後結帳': { en: 'Pay After Meal', ja: '食後会計', ko: '식후 결제' },
  '尚有加點待補款': { en: 'Add-on Balance Due', ja: '追加注文未払い', ko: '추가 주문 미결제' },
  '取餐付現': { en: 'Cash at Pickup', ja: '受取時現金', ko: '픽업 시 현금' },
  '待櫃檯繳費': { en: 'Pay at Counter', ja: '店頭払い待ち', ko: '카운터 결제 대기' },
  '待付訂確認': { en: 'Deposit Pending', ja: '前金確認待ち', ko: '선금 확인 대기' },
  '已接單待排程': { en: 'Scheduled', ja: '予約受付済', ko: '예약 접수됨' },
  '待付款確認': { en: 'Pending Payment', ja: 'お支払い待ち', ko: '결제 대기' },
  '待付款 (LINE Pay 授權中)': { en: 'Awaiting LINE Pay', ja: 'LINE Pay決済待ち', ko: 'LINE Pay 결제 대기' },
  '已逾期取消': { en: 'Expired & Cancelled', ja: '期限切れ取消', ko: '만료 취소' },
  '已退單作廢': { en: 'Voided', ja: '取消・無効', ko: '취소 무효' },
  '已退單': { en: 'Voided', ja: '取消・無効', ko: '취소됨' },
  '現場單': { en: 'Counter', ja: '店頭', ko: '매장' },
  '線上單': { en: 'Online', ja: 'オンライン', ko: '온라인' },
  '預訂單': { en: 'Pre-order', ja: '予約', ko: '예약' },
  '製作中': { en: 'Preparing', ja: '調理中', ko: '조리 중' },
  '可取餐': { en: 'Ready for Pickup', ja: '受取可能', ko: '픽업 가능' },
  '已完成': { en: 'Completed', ja: '完了', ko: '완료' },
  '已取消': { en: 'Cancelled', ja: 'キャンセル済', ko: '취소됨' },
  '已付款': { en: 'Paid', ja: '支払済', ko: '결제 완료' },
  '現場現金': { en: 'Cash', ja: '現金', ko: '현금' },
  '複合付款': { en: 'Split Payment', ja: '併用払い', ko: '복합 결제' },
  'LINE Pay 行動支付': { en: 'LINE Pay', ja: 'LINE Pay', ko: 'LINE Pay' },
  '現場POS': { en: 'Counter POS', ja: '店頭POS', ko: '매장 POS' },
  '線上點餐': { en: 'Online Order', ja: 'オンライン注文', ko: '온라인 주문' },
  '掃碼點餐': { en: 'QR Order', ja: 'QR注文', ko: 'QR 주문' },
  '早班': { en: 'Morning Shift', ja: '早番', ko: '오전 근무' },
  '晚班': { en: 'Evening Shift', ja: '遅番', ko: '오후 근무' },
  '全日班': { en: 'Full Day Shift', ja: '終日シフト', ko: '종일 근무' },
  '全日': { en: 'Full Day', ja: '終日', ko: '종일' },

  // 系統核心短詞
  '連線中': { en: 'Connecting...', ja: '接続中...', ko: '연결 중...' },
  '同步中...': { en: 'Syncing...', ja: '同期中...', ko: '동기화 중...' },
  '已同步': { en: 'Synced', ja: '同期済', ko: '동기화됨' },
  '離線模式': { en: 'Offline', ja: 'オフライン', ko: '오프라인' },
  '網路已中斷': { en: 'Network Disconnected', ja: 'ネットワーク切断', ko: '네트워크 연결 끊김' },
  '網路離線待命': { en: 'Offline Standby', ja: 'オフライン待機', ko: '오프라인 대기' },
  '同步失敗(點此重試)': { en: 'Sync Failed (Retry)', ja: '同期失敗(再試行)', ko: '동기화 실패(재시도)' },
  '系統入口導覽': { en: 'Portal Home', ja: 'ポータルホーム', ko: '포털 홈' },
  '線上點餐系統': { en: 'Campus Ordering', ja: 'オンライン注文', ko: '온라인 주문' },
  '店家櫃檯收銀與營運中心': { en: 'Merchant POS & Operations', ja: '店舗POS・管理センター', ko: '매장 POS・운영 센터' },
  '訂單專屬追蹤憑證': { en: 'Order Pickup Ticket', ja: '受取電子チケット', ko: '주문 픽업 티켓' },
  '顧客即時取餐叫號大螢幕看板': { en: 'Live Pickup Call Board', ja: '受取番号ディスプレイ', ko: '실시간 픽업 호출 전광판' },
  '營業中': { en: 'Open', ja: '営業中', ko: '영업 중' },
  '暫停營業': { en: 'Paused', ja: '営業休止', ko: '영업 중지' },
  '交班日結單': { en: 'Shift Z-Report', ja: 'シフト精算書', ko: '교대 마감 정산서' },
  '交班日結': { en: 'Z-Report', ja: 'レジ締め', ko: '마감 정산' },
  '同步雲端': { en: 'Sync Cloud', ja: 'クラウド同期', ko: '클라우드 동기화' },
  '鎖定後台': { en: 'Lock POS', ja: '画面ロック', ko: 'POS 잠금' },
  '叫號看板': { en: 'Call Board', ja: '呼出ボード', ko: '호출 전광판' },
  '我的訂單 / 查單': { en: 'My Orders', ja: '注文履歴', ko: '주문 내역' },
  '我的訂單': { en: 'My Orders', ja: '注文履歴', ko: '주문 내역' },
  '綁定取餐通知': { en: 'Pickup Alerts', ja: '受取通知連携', ko: '픽업 알림 연동' },
  '全部櫃位': { en: 'All', ja: 'すべて', ko: '전체' },
  '免排隊': { en: 'Fast', ja: '待ちなし', ko: '빠른 픽업' },
  '離峰優惠': { en: 'Off-Peak Deals', ja: '割引', ko: '할인 혜택' },
  '選餐助手': { en: 'Advisor', ja: 'おすすめ', ko: '추천' },
  '查單': { en: 'Lookup', ja: '照会', ko: '조회' },
  '全部': { en: 'All', ja: 'すべて', ko: '전체' },
  '點餐': { en: 'Order', ja: '注文', ko: '주문' },
  '訂單': { en: 'Orders', ja: '注文', ko: '주문' },
  '分析': { en: 'Stats', ja: '分析', ko: '분석' },
  '設定': { en: 'Settings', ja: '設定', ko: '설정' },
  '確認餐點並送出訂單': { en: 'Place Order', ja: '注文を確定する', ko: '주문 확정하기' },
  '確認送出訂單': { en: 'Place Order', ja: '注文を確定', ko: '주문 확정' },
  '確認加入': { en: 'Add to Cart', ja: 'カートに追加', ko: '장바구니 담기' },
  '立即製作': { en: 'Make Now', ja: '今すぐ調理', ko: '바로 조리' },
  '預訂取餐': { en: 'Pre-order', ja: '時間指定予約', ko: '예약 픽업' },
  '無優惠': { en: 'No Promo', ja: '割引なし', ko: '할인 없음' },
  '標準原味': { en: 'Standard', ja: '標準', ko: '기본' },
  '發送': { en: 'Send', ja: '送信', ko: '전송' },
  '確認': { en: 'Confirm', ja: '確認', ko: '확인' },
  '取消': { en: 'Cancel', ja: 'キャンセル', ko: '취소' },
  '關閉': { en: 'Close', ja: '閉じる', ko: '닫기' },
  '儲存': { en: 'Save', ja: '保存', ko: '저장' },
  '編輯': { en: 'Edit', ja: '編集', ko: '수정' },
  '刪除': { en: 'Delete', ja: '削除', ko: '삭제' },
  '刪': { en: 'Del', ja: '削除', ko: '삭제' },
  '自取': { en: 'Pickup', ja: '受取', ko: '픽업' },

  // Built-in default sample menu items (S01 demo fallback)
  '特製韓式泡菜燒肉飯捲': { en: 'Kimchi Grilled Pork Kimbap', ja: '特製キムチ焼肉キンパ', ko: '특제 김치 불고기 김밥' },
  '起司炸蝦海苔飯捲': { en: 'Cheese Fried Shrimp Kimbap', ja: 'チーズエビフライキンパ', ko: '치즈 새우튀김 김밥' },
  '經典鮪魚玉米飯捲': { en: 'Classic Tuna Corn Kimbap', ja: '定番ツナコーンキンパ', ko: '클래식 참치 옥수수 김밥' },
  '釜山魚板蘿蔔湯': { en: 'Busan Fish Cake Radish Soup', ja: '釜山おでん大根スープ', ko: '부산 어묵 무국' },
  '韓國水蜜桃果粒飲': { en: 'Korean Peach Pulp Drink', ja: '韓国白桃果肉ドリンク', ko: '한국 복숭아 알갱이 음료' },
  '招牌主餐': { en: 'Signature Main', ja: 'おすすめメイン', ko: '대표 메뉴' },
  '移除': { en: 'Remove', ja: '削除', ko: '제거' },
  '清空': { en: 'Clear', ja: 'クリア', ko: '비우기' },
  '套用': { en: 'Apply', ja: '適用', ko: '적용' },
  '上架': { en: 'Restock', ja: '販売再開', ko: '판매 재개' },
  '售罄': { en: 'Sold Out', ja: '売切れ', ko: '품절' },
  '已售罄': { en: 'Sold Out', ja: '売切れ', ko: '품절' },
  '掛單': { en: 'Hold', ja: '保留', ko: '보류' },
  '開班點鈔': { en: 'Open Shift', ja: '開局準備金', ko: '개시 시재' },
  '自訂': { en: 'Custom', ja: 'カスタム', ko: '직접 입력' },
  '全單招待': { en: 'Comp Order', ja: '全額サービス', ko: '전액 무료' },
  '剛好': { en: 'Exact', ja: 'ぴったり', ko: '정확히' },
  '鍵盤': { en: 'Numpad', ja: 'テンキー', ko: '키패드' },
  '收款': { en: 'Pay', ja: '会計', ko: '수금' },
  '留言': { en: 'Message', ja: 'メッセージ', ko: '메시지' },
  '讀單': { en: 'Read', ja: '読上', ko: '읽기' },
  '改單': { en: 'Modify', ja: '変更', ko: '수정' },
  '退單': { en: 'Void', ja: '取消', ko: '취소' },
  '外帶': { en: 'Takeout', ja: 'テイクアウト', ko: '포장' },
  '內用': { en: 'Dine-in', ja: '店内', ko: '매장' },
  '正常': { en: 'Regular', ja: '普通', ko: '보통' },
  '解除綁定': { en: 'Unbind', ja: '連携解除', ko: '연동 해제' },
  '尚無推播紀錄': { en: 'No notification history yet', ja: '通知履歴はありません', ko: '알림 기록이 없습니다' },
  '值班店長': { en: 'Shift Manager', ja: '当番店長', ko: '당번 점장' },
  '當班店長': { en: 'Shift Manager', ja: '当番店長', ko: '당번 점장' },
  '早班店長': { en: 'Morning Manager', ja: '早番店長', ko: '오전 점장' },
  '晚班店長': { en: 'Evening Manager', ja: '遅番店長', ko: '오후 점장' },
  '早班收銀': { en: 'Morning Cashier', ja: '早番レジ担当', ko: '오전 캐셔' },
  '晚班收銀': { en: 'Evening Cashier', ja: '遅番レジ担当', ko: '오후 캐셔' },
  '當班收銀員': { en: 'Shift Cashier', ja: '当番レジ担当', ko: '당번 캐셔' },
  '值班人員': { en: 'Staff on Duty', ja: '担当スタッフ', ko: '근무 직원' },
  '店長': { en: 'Manager', ja: '店長', ko: '점장' },
  '收銀員': { en: 'Cashier', ja: 'スタッフ', ko: '캐셔' },
  '開發者': { en: 'Developer', ja: '開発者', ko: '개발자' },
  '系統開發者': { en: 'System Developer', ja: 'システム開発者', ko: '시스템 개발자' },
  '開發者 (Developer)': { en: 'Developer', ja: '開発者 (Developer)', ko: '개발자 (Developer)' },
  '營業中 (點此切換)': { en: 'Open (Tap to Pause)', ja: '営業中 (タップで休止)', ko: '영업 중 (탭하여 중지)' },
  '暫停營業 (點此開啟)': { en: 'Paused (Tap to Open)', ja: '営業休止 (タップで再開)', ko: '영업 중지 (탭하여 재개)' },
  '已打烊 (開放預訂)': { en: 'Closed (Pre-order)', ja: '営業終了 (予約可)', ko: '영업 종료 (예약 가능)' },
  '全部日期': { en: 'All Dates', ja: 'すべての日付', ko: '전체 날짜' },
  '全部狀態': { en: 'All Status', ja: 'すべての状態', ko: '전체 상태' },
  '立即出餐': { en: 'Make Now', ja: '即時調理', ko: '즉시 조리' },
  '暫停中': { en: 'Paused', ja: '休止中', ko: '중지됨' }
};

const DIETARY_TAG_MAP = {
  SPICY: { zh: '🌶️ 辣', en: '🌶️ Spicy', ja: '🌶️ 辛口', ko: '🌶️ 매운맛' },
  VEG: { zh: '🥬 蔬食', en: '🥬 Veg', ja: '🥬 野菜・ベジ', ko: '🥬 채식' },
  BEEF: { zh: '🐮 含牛', en: '🐮 Beef', ja: '🐮 牛肉含', ko: '🐮 소고기' },
  PORK: { zh: '🐷 含豬', en: '🐷 Pork', ja: '🐷 豚肉含', ko: '🐷 돼지고기' },
  NUTS: { zh: '🥜 堅果', en: '🥜 Nuts', ja: '🥜 ナッツ', ko: '🥜 견과류' },
  SEAFOOD: { zh: '🦐 海鮮', en: '🦐 Seafood', ja: '🦐 海鮮', ko: '🦐 해산물' },
  DAIRY: { zh: '🥛 蛋奶', en: '🥛 Dairy/Egg', ja: '🥛 卵・乳', ko: '🥛 유제품/계란' }
};

function trDietaryTag(code) {
  const rec = DIETARY_TAG_MAP[String(code || '').trim().toUpperCase()];
  if (!rec) return String(code || '');
  return t(rec.zh, rec.en, rec.ja, rec.ko);
}

// 2. 後端錯誤與系統動態模板（帶參數精準翻譯）
const SERVER_ERROR_PATTERNS = [
  [/^找不到該筆訂單[:：]\s*(.+)$/, (m) => t(m[0], `Order not found: ${m[1]}`, `注文が見つかりません: ${m[1]}`, `주문을 찾을 수 없습니다: ${m[1]}`)],
  [/目前為「暫停營業」狀態/, () => t('本店目前為「暫停營業」狀態，暫停現場點餐與所有預訂服務，請稍後再試。', 'This store is currently paused. Ordering and pre-orders are temporarily unavailable.', '現在一時営業休止中のため、注文・予約を停止しております。', '현재 임시 영업 중지 상태이므로 주문 및 예약이 불가합니다.')],
  [/核銷碼驗證失敗/, () => t('核銷碼驗證失敗，請確認 6 碼取餐核銷碼後再試', 'Invalid 6-char verification code. Please check and try again.', '認証コードが一致しません。6桁のコードをご確認ください。', '인증 코드가 일치하지 않습니다. 6자리 코드를 확인해 주세요.')],
  [/訂單已進入廚房備餐或完成階段/, () => t('訂單已進入廚房備餐或完成階段，無法由線上自助取消，請洽詢店家櫃檯處理。', 'This order is already preparing or completed and cannot be self-cancelled. Please contact the counter.', 'すでに調理中または完了しているためキャンセルできません。店頭へご相談ください。', '이미 조리 중이거나 완료된 주문은 온라인 취소가 불가합니다. 카운터에 문의하세요.')],
  [/本店尚未設定真實 LINE Pay 商家金鑰/, () => t('本店尚未設定真實 LINE Pay 商家金鑰，請改用「現場取餐付現」或洽店長設定。', 'LINE Pay is not configured for this store yet. Please pay cash at pickup.', 'この店舗はLINE Pay未設定です。店頭現金払いをご利用ください。', '이 매장은 LINE Pay가 설정되지 않았습니다. 현장 현금 결제를 이용해 주세요.')],
  [/尚未完成付款確認/, () => t('此訂單尚未完成付款確認，請先收款後再核銷交付', 'Payment not settled yet. Please collect payment first.', 'まだお支払いが完了していません。先に会計を完了してください。', '결제가 완료되지 않았습니다. 먼저 결제 후 완료 처리하세요.')],
  [/此操作需店長授權|需店長權限|MANAGER_REQUIRED/, () => t('此操作需店長權限，請輸入店長 PIN 覆核授權', 'Manager approval required. Please enter the Manager PIN.', '店長権限が必要です。店長PINを入力してください。', '점장 권한이 필요합니다. 점장 PIN을 입력해 주세요.')],
  [/店長覆核.*錯誤|授權碼錯誤/, () => t('授權碼驗證錯誤，請重新輸入', 'Incorrect PIN code. Please try again.', 'PINコードが正しくありません。', 'PIN 번호가 올바르지 않습니다.')],
  [/權限驗證失敗|請重新輸入.*PIN|Unauthorized/, () => t('店務權限已失效，請重新輸入授權碼', 'Merchant session expired. Please re-enter store PIN.', '店舗認証が期限切れです。PINを再入力してください。', '매장 인증이 만료되었습니다. PIN을 다시 입력해 주세요.')],
  [/已達本日限量上限|目前已售罄/, (m) => t(m[0], 'Item sold out or reached daily limit', '売切れまたは1日限定数に達しました', '품절되었거나 일일 한정 수량에 도달했습니다')],
  [/優惠券無效|未達優惠券低消/, (m) => t(m[0], 'Coupon invalid or minimum spend not met', 'クーポン無効または最低利用金額未満です', '쿠폰이 유효하지 않거나 최소 주문 금액 미만입니다')],
  [/查單嘗試次數過於頻繁/, () => t('查單次數過於頻繁，請 60 秒後再試', 'Too many lookup attempts. Please wait 60s and try again.', '照会回数が多すぎます。60秒後に再試行してください。', '조회 시도가 너무 많습니다. 60초 후 다시 시도하세요.')],
  [/統一編號格式或邏輯檢核碼錯誤/, () => t('統一編號格式或邏輯檢核碼錯誤（請輸入有效之 8 碼台灣統一編號）', 'Invalid Taiwan Tax ID (must pass 8-digit checksum).', '台湾統一番号（8桁）の形式またはチェックサムが正しくありません。', '올바른 8자리 대만 사업자등록번호가 아닙니다.')],
  [/已鎖定.*帳務|本班次已日結鎖定/, () => t('本日帳務已交班鎖定，如需補登請由店長解除鎖定', 'Today\'s shift is locked. Manager unlock is required.', '本日の精算はロック済です。店長の解除が必要です。', '오늘 마감 정산이 잠겨 있습니다. 점장 해제가 필요합니다.')],
  [/付款逾時|已逾期取消/, () => t('LINE Pay 付款已逾時取消，請重新下單', 'LINE Pay payment expired. Please place your order again.', 'LINE Pay決済が期限切れになりました。再度ご注文ください。', 'LINE Pay 결제가 만료되었습니다. 다시 주문해 주세요.')],
  [/OneTimeKey|付款條碼/, (m) => t(m[0], 'Invalid or expired LINE Pay OneTimeKey barcode. Please scan again.', 'LINE Pay決済コードが無効または期限切れです。再スキャンしてください。', 'LINE Pay 결제 바코드가 유효하지 않거나 만료되었습니다. 다시 스캔해 주세요.')]
];

const UI_DYNAMIC_PATTERNS = [
  [/^最後同步時間[:：]\s*(.+)$/, (m) => t(m[0], `Last synced: ${m[1]}`, `最終同期: ${m[1]}`, `마지막 동기화: ${m[1]}`)],
  [/^切換店鋪[:：]\s*(.+)$/, (m) => t(m[0], `Store: ${trTerm(m[1])}`, `店舗切替: ${trTerm(m[1])}`, `매장 전환: ${trTerm(m[1])}`)],
  [/^(\d+)\s*進行中$/, (m) => t(m[0], `${m[1]} active`, `${m[1]}件進行中`, `${m[1]}건 진행 중`)],
  [/^約\s*(\d+)\s*分(?:鐘)?取餐$/, (m) => t(m[0], `~${m[1]} min`, `約${m[1]}分`, `약 ${m[1]}분`)],
  [/^約\s*(\d+)\s*分$/, (m) => t(m[0], `~${m[1]} min`, `約${m[1]}分`, `약 ${m[1]}분`)],
  [/^忙碌・約\s*(\d+)\s*分$/, (m) => t(m[0], `Busy ~${m[1]}m`, `混雑 約${m[1]}分`, `혼잡 약 ${m[1]}분`)],
  [/^適中・約\s*(\d+)\s*分$/, (m) => t(m[0], `~${m[1]} min`, `約${m[1]}分`, `약 ${m[1]}분`)],
  [/^(\d+)\s*道供應中$/, (m) => t(m[0], `${m[1]} dishes`, `${m[1]}品提供中`, `${m[1]}개 메뉴`)],
  [/^共\s*×(\d+)$/, (m) => t(m[0], `Total ×${m[1]}`, `計 ×${m[1]}`, `총 ×${m[1]}`)],
  [/^共\s*(\d+)\s*份餐點?$/, (m) => t(m[0], `${m[1]} items`, `計${m[1]}点`, `총 ${m[1]}개`)],
  [/^(\d+)\s*份\s*\/\s*\$(\d+)$/, (m) => t(m[0], `${m[1]} pcs / $${m[2]}`, `${m[1]}点 / $${m[2]}`, `${m[1]}개 / $${m[2]}`)],
  [/^(\d+)\s*份\s*\(\$(\d+)\s*\/\s*(\d+)%\)$/, (m) => t(m[0], `${m[1]} pcs ($${m[2]} / ${m[3]}%)`, `${m[1]}点 ($${m[2]} / ${m[3]}%)`, `${m[1]}개 ($${m[2]} / ${m[3]}%)`)],
  [/^(\d+)\s*份\s*\/\s*NT\$\s*([\d,]+)$/, (m) => t(m[0], `${m[1]} pcs / NT$ ${m[2]}`, `${m[1]}点 / NT$ ${m[2]}`, `${m[1]}개 / NT$ ${m[2]}`)],
  [/^(\d+)\s*分\((\d+)單\)$/, (m) => t(m[0], `${m[1]}m (${m[2]})`, `${m[1]}分(${m[2]}件)`, `${m[1]}분(${m[2]}건)`)],
  [/^(\d+)-(\d+)時$/, (m) => t(m[0], `${m[1]}-${m[2]}h`, `${m[1]}-${m[2]}時`, `${m[1]}-${m[2]}시`)],
  [/^(\d+)時後$/, (m) => t(m[0], `${m[1]}h+`, `${m[1]}時以降`, `${m[1]}시 이후`)],
  [/^(\d+)\s*份$/, (m) => t(m[0], `${m[1]} items`, `${m[1]}点`, `${m[1]}개`)],
  [/^(\d+)\s*單$/, (m) => t(m[0], `${m[1]} orders`, `${m[1]}件`, `${m[1]}건`)],
  [/^(\d+)\s*筆$/, (m) => t(m[0], `${m[1]} orders`, `${m[1]}件`, `${m[1]}건`)],
  [/^今日\s*\(([^)]+)\)\s*\[(\d+)\]$/, (m) => t(m[0], `Today (${m[1]}) [${m[2]}]`, `本日 (${m[1]}) [${m[2]}]`, `오늘 (${m[1]}) [${m[2]}]`)],
  [/^明日\s*\(([^)]+)\)\s*\[(\d+)\]$/, (m) => t(m[0], `Tomorrow (${m[1]}) [${m[2]}]`, `明日 (${m[1]}) [${m[2]}]`, `내일 (${m[1]}) [${m[2]}]`)],
  [/^📅\s*今日逐時\s*\((\d+)單\)$/, (m) => t(m[0], `📅 Today Hourly (${m[1]})`, `📅 本日時間帯別 (${m[1]}件)`, `📅 오늘 시간별 (${m[1]}건)`)],
  [/^🗓️\s*全區間含未來預訂\s*\((\d+)單\)$/, (m) => t(m[0], `🗓️ All + Future Pre-orders (${m[1]})`, `🗓️ 全期間・未来予約含む (${m[1]}件)`, `🗓️ 전체 + 향후 예약 (${m[1]}건)`)],
  [/^已收款\s*(\d+)\s*單\s*・\s*客單價\s*NT\$\s*([\d,]+)$/, (m) => t(m[0], `Paid ${m[1]} orders • Avg NT$ ${m[2]}`, `支払済 ${m[1]}件・客単価 NT$ ${m[2]}`, `결제 ${m[1]}건 • 평균 NT$ ${m[2]}`)],
  [/^區間待收\s*(\d+)\s*單\s*・\s*未來預訂\s*(\d+)\s*單$/, (m) => t(m[0], `Unpaid ${m[1]} • Future Pre-order ${m[2]}`, `未収 ${m[1]}件・未来予約 ${m[2]}件`, `미수금 ${m[1]}건 • 향후 예약 ${m[2]}건`)],
  [/^基礎\s*(\d+)分\s*・\s*佇列\s*(\d+)\/(\d+)\s*單\s*\((\d+)%\)$/, (m) => t(m[0], `Base ${m[1]}m • Queue ${m[2]}/${m[3]} (${m[4]}%)`, `基本${m[1]}分・待機 ${m[2]}/${m[3]} (${m[4]}%)`, `기본 ${m[1]}분 • 대기 ${m[2]}/${m[3]} (${m[4]}%)`)],
  [/^總折扣成本\s*-NT\$\s*([\d,]+)$/, (m) => t(m[0], `Total Discounts -NT$ ${m[1]}`, `割引コスト計 -NT$ ${m[1]}`, `총 할인 비용 -NT$ ${m[1]}`)],
  [/^⏱️\s*已下鍋\s*(\d+)分\s*\(負荷\s*([\d.]+)\)$/, (m) => t(m[0], `⏱️ Cooking ${m[1]}m (Load ${m[2]})`, `⏱️ 調理${m[1]}分 (負荷 ${m[2]})`, `⏱️ 조리 ${m[1]}분 (부하 ${m[2]})`)],
  [/^💵\s*點此收款結帳\s*\(NT\$\s*([\d,]+)\)$/, (m) => t(m[0], `💵 Collect Payment (NT$ ${m[1]})`, `💵 会計する (NT$ ${m[1]})`, `💵 결제 수금 (NT$ ${m[1]})`)],
  [/^✅\s*確認收訖\s*NT\$\s*([\d,]+)$/, (m) => t(m[0], `✅ Confirm Received NT$ ${m[1]}`, `✅ 受領確定 NT$ ${m[1]}`, `✅ 수금 확인 NT$ ${m[1]}`)],
  [/^⚙️\s*(\d+)\s*組選項\s*\(ID:([^)]+)\)$/, (m) => t(m[0], `⚙️ ${m[1]} option groups (ID:${m[2]})`, `⚙️ ${m[1]}組オプション (ID:${m[2]})`, `⚙️ 옵션 ${m[1]}개 그룹 (ID:${m[2]})`)],
  [/^📋\s*目前架上菜單（共\s*(\d+)\s*道，支援每日限量自動扣減售罄與客製加料規則）$/, (m) => t(m[0], `📋 Active Menu (${m[1]} items • supports daily limits & custom modifiers)`, `📋 登録メニュー（全${m[1]}品・日次数量限定・オプション対応）`, `📋 등록 메뉴 (총 ${m[1]}개 • 일일 한정・커스텀 옵션 지원)`)],
  [/^製作中\s*(\d+)\s*單\s*・\s*合共\s*(\d+)\s*份餐點$/, (m) => t(m[0], `Preparing ${m[1]} orders • ${m[2]} items total`, `調理中 ${m[1]}件・計 ${m[2]}点`, `조리 중 ${m[1]}건 • 총 ${m[2]}개`)],
  [/^應有\s*\$(\d+)$/, (m) => t(m[0], `Expected $${m[1]}`, `理論額 $${m[1]}`, `예상 $${m[1]}`)],
  [/^NT\$\s*([\d,\-]+)\s*\(帳實相符\)$/, (m) => t(m[0], `NT$ ${m[1]} (Balanced)`, `NT$ ${m[1]} (一致)`, `NT$ ${m[1]} (일치)`)],
  [/^最近\s*(\d+)\s*筆紀錄$/, (m) => t(m[0], `Latest ${m[1]} records`, `直近 ${m[1]}件`, `최근 ${m[1]}건`)],
  [/^(\d+)\s*筆未來日期預訂單$/, (m) => t(m[0], `${m[1]} future pre-orders`, `未来日の予約 ${m[1]}件`, `향후 예약 주문 ${m[1]}건`)],
  [/^，佔比\s*(\d+)%）。$/, (m) => t(m[0], `, ${m[1]}% share).`, `、シェア${m[1]}%）。`, `, 점유율 ${m[1]}%).`)],
  [/^掛單\s*\((\d+)\)$/, (m) => t(m[0], `Hold (${m[1]})`, `保留 (${m[1]})`, `보류 (${m[1]})`)],
  [/^剩\s*(\d+)\s*份$/, (m) => t(m[0], `${m[1]} left`, `残り${m[1]}`, `${m[1]}개 남음`)],
  [/^已備齊\s*(\d+)\s*\/\s*(\d+)\s*項$/, (m) => t(m[0], `Ready ${m[1]}/${m[2]}`, `準備済 ${m[1]}/${m[2]}`, `준비됨 ${m[1]}/${m[2]}`)],
  [/^第\s*(\d+)\s*次呼叫$/, (m) => t(m[0], `Call #${m[1]}`, `${m[1]}回目呼出`, `${m[1]}회 호출`)],
  [/^核銷碼[:：]\s*([A-Z0-9*]+)$/, (m) => t(m[0], `Code: ${m[1]}`, `認証コード: ${m[1]}`, `인증코드: ${m[1]}`)],
  [/^取餐號\s*#([A-Z0-9\-]+)\s*\(核銷碼\s*([A-Z0-9*]+)\)$/, (m) => t(m[0], `Pickup #${m[1]} (Code ${m[2]})`, `受取 #${m[1]} (認証 ${m[2]})`, `픽업 #${m[1]} (코드 ${m[2]})`)],
  [/^預覽單號\s*#([A-Z0-9\-]+)[（(]([^）)]+)[）)]$/, (m) => t(m[0], `Preview #${m[1]} (${translateSystemText(m[2])})`, `プレビュー #${m[1]} (${translateSystemText(m[2])})`, `미리보기 #${m[1]} (${translateSystemText(m[2])})`)],
  [/^🧾\s*預覽單號\s*#([A-Z0-9\-]+)[（(]([^）)]+)[）)]$/, (m) => t(m[0], `🧾 Preview #${m[1]} (${translateSystemText(m[2])})`, `🧾 プレビュー #${m[1]} (${translateSystemText(m[2])})`, `🧾 미리보기 #${m[1]} (${translateSystemText(m[2])})`)],
  [/^✅\s*確認收款並立即出單\s*#([A-Z0-9\-]+)$/, (m) => t(m[0], `✅ Confirm Payment & Print #${m[1]}`, `✅ 会計確定・発券 #${m[1]}`, `✅ 결제 확인 및 출식 #${m[1]}`)],
  [/^櫃檯點餐單\s*\(#([A-Z0-9\-]+)\)$/, (m) => t(m[0], `Counter Ticket (#${m[1]})`, `レジ注文票 (#${m[1]})`, `카운터 주문서 (#${m[1]})`)],
  [/^前往收銀確認\s*\(NT\$\s*([\d,]+)\)\s*[→➔]?$/, (m) => t(m[0], `Checkout (NT$ ${m[1]}) →`, `会計確認へ (NT$ ${m[1]}) →`, `결제 확인 (NT$ ${m[1]}) →`)],
  [/^💳\s*前往收銀確認\s*\(NT\$\s*([\d,]+)\)\s*[→➔]?$/, (m) => t(m[0], `💳 Checkout (NT$ ${m[1]}) →`, `💳 会計確認へ (NT$ ${m[1]}) →`, `💳 결제 확인 (NT$ ${m[1]}) →`)],
  [/^(.+?)\s*・\s*共\s*(\d+)\s*份餐點$/, (m) => t(m[0], `${trTerm(m[1])} • ${m[2]} items`, `${trTerm(m[1])}・計 ${m[2]}点`, `${trTerm(m[1])} • 총 ${m[2]}개`)],
  [/^🛡️\s*目前\s*Session\s*憑證有效（範圍[:：]\s*(\S+)\s*・\s*剩餘約\s*(\d+)\s*分鐘）$/, (m) => t(m[0], `🛡️ Session Active (Store: ${m[1]} • ~${m[2]}m left)`, `🛡️ セッション有効 (店舗: ${m[1]}・残り約${m[2]}分)`, `🛡️ 세션 유효 (매장: ${m[1]} • 약 ${m[2]}분 남음)`)],
  [/^🏪\s*綁定「([^」]+)」專屬官方帳號$/, (m) => t(m[0], `🏪 Link "${trTerm(m[1])}" Custom LINE OA`, `🏪 「${trTerm(m[1])}」専用LINE公式アカウント連携`, `🏪 "${trTerm(m[1])}" 전용 LINE 공식계정 연동`)],
  [/^📌\s*將此平板綁定為「([^」]+)」專用機$/, (m) => t(m[0], `📌 Bind Tablet to "${trTerm(m[1])}"`, `📌 この端末を「${trTerm(m[1])}」専用機に設定`, `📌 이 태블릿을 "${trTerm(m[1])}" 전용기로 고정`)],
  [/^✅\s*已綁定為「([^」]+)」專用機\s*\(點此解除\)$/, (m) => t(m[0], `✅ Bound to "${trTerm(m[1])}" (Tap to Unbind)`, `✅ 「${trTerm(m[1])}」専用機に設定済 (解除)`, `✅ "${trTerm(m[1])}" 전용기 고정됨 (해제)`)],
  [/^輸入「([^」]+)」目前舊店長\s*PIN\s*\(4~8碼\)\s*\*?$/, (m) => t(m[0], `Current Manager PIN for "${trTerm(m[1])}" (4-8 digits) *`, `「${trTerm(m[1])}」現在の店長PIN (4〜8桁) *`, `"${trTerm(m[1])}" 현재 점장 PIN (4~8자리) *`)],
  [/^設定「([^」]+)」新店長\s*PIN\s*\(4~8碼\)\s*\*?$/, (m) => t(m[0], `New Manager PIN for "${trTerm(m[1])}" (4-8 digits) *`, `「${trTerm(m[1])}」新店長PIN (4〜8桁) *`, `"${trTerm(m[1])}" 새 점장 PIN (4~8자리) *`)],
  [/^平均客單價[:：]\s*NT\$\s*([\d,]+)$/, (m) => t(m[0], `Avg Order Value: NT$ ${m[1]}`, `平均客単価: NT$ ${m[1]}`, `평균 객단가: NT$ ${m[1]}`)],
  [/^總折扣成本\s*-NT\$\s*([\d,]+)$/, (m) => t(m[0], `Total Discounts -NT$ ${m[1]}`, `割引コスト計 -NT$ ${m[1]}`, `총 할인 비용 -NT$ ${m[1]}`)],
  [/^🥢\s*餐具\(\+\$(\d+)\)$/, (m) => t(m[0], `🥢 Cutlery (+$${m[1]})`, `🥢 箸・スプーン (+$${m[1]})`, `🥢 수저 (+$${m[1]})`)],
  [/^🥢\s*餐具\(\$0\)$/, () => t('🥢 餐具($0)', '🥢 Cutlery ($0)', '🥢 カトラリー($0)', '🥢 수저 ($0)')],
  [/^含免洗餐具\+\$(\d+)$/, (m) => t(m[0], `Cutlery +$${m[1]}`, `カトラリー+$${m[1]}`, `일회용품 +$${m[1]}`)],
  [/^離峰折抵-\$(\d+)$/, (m) => t(m[0], `Promo -$${m[1]}`, `割引-$${m[1]}`, `할인 -$${m[1]}`)],
  [/^已過\s*(\d+)\s*分$/, (m) => t(m[0], `${m[1]}m elapsed`, `${m[1]}分経過`, `${m[1]}분 경과`)],
  [/^已選\s*(\d+)\s*項$/, (m) => t(m[0], `${m[1]} selected`, `${m[1]}件選択`, `${m[1]}개 선택`)],
  [/^滿\s*\$(\d+)$/, (m) => t(m[0], `Min $${m[1]}`, `$${m[1]}以上`, `$${m[1]} 이상`)],
  [/^[（(]滿\s*\$(\d+)[）)]$/, (m) => t(m[0], `(Min $${m[1]})`, `($${m[1]}以上)`, `($${m[1]} 이상)`)]
];

// 3. 完整長詞優先 UI 翻譯詞表（涵蓋所有頁面、POS、KDS、分析、日結、小票、設定四分頁、全部彈窗與提示）
const UI_PHRASE_TRANSLATIONS = [
  // ---- Portal 入口頁 ----
  ['ISO/IEC 18004 真實 QR 核銷 × 時段配額控管 × KDS 鏡頭掃碼 × 會計級交班日結單', 'ISO/IEC 18004 Verified QR × 15m Slot Quota × KDS Camera Scan × Shift Z-Report', 'ISO/IEC 18004 QR認証 × 時間枠制御 × KDSスキャン × シフト精算書', 'ISO/IEC 18004 QR 인증 × 시간대 정원 × KDS 스캔 × 마감 정산서'],
  ['ISO/IEC 18004 真實 QR 核銷 × 時段配額控管 × KDS 鏡頭掃碼 × 會計級交班日結', 'ISO/IEC 18004 Verified QR × 15m Slot Quota × KDS Camera Scan × Shift Z-Report', 'ISO/IEC 18004 QR認証 × 時間枠制御 × KDSスキャン × シフト精算', 'ISO/IEC 18004 QR 인증 × 시간대 정원 × KDS 스캔 × 마감 정산'],
  ['支援 15 分鐘時段配額預訂、動態產能候餐預估、多輪智慧選餐顧問與標準 ISO QR Code 防偽電子取餐單。', '15-min slot quota pre-orders, live wait estimates, AI advisor, and ISO QR pickup tickets.', '15分枠予約、リアルタイム待ち時間予測、AI案内、ISO QR電子チケット対応。', '15분 단위 예약 정원, 실시간 대기 예측, AI 추천, ISO QR 픽업 티켓 지원.'],
  ['具備 4 碼雲端 HMAC Session 保護、KDS 鏡頭掃碼核銷、未收款結單強制防呆攔截與完整錢箱交班日結單。', 'Cloud HMAC PIN security, KDS camera QR verification, unpaid checkout guard, and full Shift Z-Reports.', 'クラウドHMAC認証、KDSカメラQR検収、未会計防止ロック、完全シフト精算書対応。', '클라우드 HMAC PIN 보안, KDS 카메라 QR 확인, 미결제 방지, 완전 교대 정산서 지원.'],
  ['全螢幕平板 POS + KDS 鏡頭掃碼核銷 + 會計日結後台 (', 'Fullscreen Tablet POS + KDS QR Scanner + Accounting Backoffice (', 'フルスクリーンPOS + KDS QR検収 + 会計管理 (', '전체화면 POS + KDS QR 스캔 + 회계 관리 ('],
  ['標準可掃描防偽 QR 電子憑證', 'Scannable Anti-Fraud QR Tickets', 'スキャン可能な偽造防止QRチケット', '스캔 가능한 위조 방지 QR 티켓'],
  ['店家全螢幕收銀・KDS 鏡頭核銷・會計日結', 'Fullscreen POS • KDS Scanner • Shift Z-Report', '店頭POS・KDS検収・レジ締め精算', '매장 POS • KDS 스캔 • 마감 정산'],
  ['線上掃碼點餐 (', 'QR Mobile Ordering (', 'スマホQR注文 (', '모바일 QR 주문 ('],
  ['學生掃碼點餐入口', 'Student QR Ordering', '学生スマホ注文入口', '학생 QR 주문 입구'],
  ['學生掃碼點餐端', 'Student Mobile Ordering', '学生モバイル注文', '학생 모바일 주문'],
  ['進入學生掃碼點餐 ➔', 'Start Ordering ➔', '注文を開始 ➔', '주문 시작하기 ➔'],
  ['商用全螢幕平板收銀', 'Commercial Tablet POS', '業務用タブレットPOS', '상업용 태블릿 POS'],
  ['進入店家營運中心 ➔', 'Open Merchant POS ➔', '店舗管理センターへ ➔', '매장 운영 센터 열기 ➔'],
  ['，以及', ', and', '、および', ', 및'],
  ['整合', 'Unified', '統合型', '통합'],

  // ---- Header / Audio Banner / Cart / My Orders ----
  ['瀏覽器接單/叫號鈴聲尚未解鎖（重整頁面後需點擊一次畫面才能發出聲音）', 'Browser chime/voice locked (tap once after reload to enable audio)', 'ブラウザ音声がロック中（画面を1回タップして音声を有効化）', '브라우저 알림음이 잠겨 있습니다 (새로고침 후 한 번 탭하여 활성화)'],
  ['點此立即啟用音效', 'Tap to Enable Sound', 'タップして音声を有効化', '탭하여 알림음 켜기'],
  ['請輸入完整手機號碼，例如：0912345678', 'Enter full mobile number, e.g. 0912345678', '携帯番号を入力（例：0912345678）', '휴대폰 번호 입력 (예: 0912345678)'],
  ['跨裝置安全找回訂單（輸入「6 碼防偽核銷碼」，或「4 碼取餐號 + 手機末 3 碼」）', 'Find order across devices (6-char code OR Pickup # + last 3 phone digits)', '他端末から注文照会（6桁認証コード、または受取番号＋携帯下3桁）', '다른 기기 주문 찾기 (6자리 인증코드 또는 픽업번호+전화 뒤 3자리)'],
  ['6碼防偽碼 或 4碼取餐號', '6-char Code or Pickup #', '6桁コードまたは受取番号', '6자리 코드 또는 픽업번호'],
  ['手機末3碼 (若用取餐號)', 'Last 3 phone digits', '携帯下3桁(番号検索時)', '전화 뒤 3자리'],
  ['驗證找回', 'Verify & Find', '照会する', '조회하기'],
  ['展開', 'Expand', '開く', '펼치기'],
  ['收合', 'Collapse', '閉じる', '접기'],
  ['通知取餐', 'Call Pickup', '受取呼出', '픽업 호출'],
  ['確認金額・收款找零與出單', 'Confirm Amount, Change & Print', '金額確認・お釣り・発券', '금액 확인・거스름돈・출식'],
  ['返回修改', 'Back to Edit', '戻って修正', '돌아가기'],
  ['新單語音播報:', 'New Order Voice:', '新規注文音声:', '신규 주문 음성:'],
  ['新單語音播報：', 'New Order Voice: ', '新規注文音声：', '신규 주문 음성: '],
  ['廚房分站過濾:', 'Kitchen Station:', 'キッチン担当:', '주방 파트 필터:'],
  ['排序:', 'Sort:', '並び順:', '정렬:'],
  ['開', 'ON', 'ON', '켜짐'],
  ['關', 'OFF', 'OFF', '꺼짐'],
  ['」（售出', '" (sold', '」（販売数', '" (판매'],
  ['系統共有', 'System has', '現在合計', '현재 총'],
  ['總折扣成本', 'Total Discounts', '割引コスト計', '총 할인 비용'],
  ['總折讓成本', 'Total Discounts', '割引コスト計', '총 할인 비용'],
  ['本店目前營業狀態', 'Current Store Status', '現在の営業状態', '현재 매장 영업 상태'],
  ['暫停營業（全面停止現場點餐與預訂）', 'Paused (Stops ALL Ordering & Pre-orders)', '営業休止（注文・予約すべて停止）', '영업 중지 (모든 주문 및 예약 중단)'],
  ['一次性免洗餐具收費金額 (NT$)', 'Disposable Cutlery Fee (NT$)', 'カトラリー料金 (NT$)', '일회용 수저 요금 (NT$)'],
  ['空閒時基礎出餐時間 (分鐘)', 'Base Prep Time (min)', '基本調理時間 (分)', '기본 조리 시간 (분)'],
  ['每 15 分鐘產能與預訂配額上限 (份數)', 'Max Capacity per 15 Min (portions)', '15分あたりの上限 (食数)', '15분당 최대 생산량 (수량)'],
  ['預訂單提前自動推入廚房時間 (分鐘)', 'Pre-order Auto-Fire Lead Time (min)', '予約自動調理開始 (分前)', '예약 자동 조리 투입 (분 전)'],
  ['預設授權頻道編號', 'Default LINE Channel ID', '標準LINEチャネルID', '기본 LINE 채널 ID'],
  ['預設：2012260287', 'Default: 2012260287', '既定: 2012260287', '기본값: 2012260287'],
  ['預設授權頻道密鑰', 'Default LINE Channel Secret', '標準LINEチャネルシークレット', '기본 LINE 채널 시크릿'],
  ['由雲端伺服器安全託管', 'Securely managed on cloud server', 'クラウドサーバーで安全に管理', '클라우드 서버에서 안전하게 관리됨'],
  ['預設訊息推播存取權杖', 'Default Push Access Token', '標準プッシュアクセストークン', '기본 푸시 액세스 토큰'],
  ['本店 LINE Pay Channel ID (商家金流代號)', 'Store LINE Pay Channel ID', '店舗 LINE Pay Channel ID', '매장 LINE Pay Channel ID'],
  ['如：1657000123 (留空使用各店獨立沙盒)', 'e.g. 1657000123 (blank for sandbox)', '例：1657000123（空欄でサンドボックス）', '예: 1657000123 (비워두면 샌드박스)'],
  ['本店 LINE Pay Channel Secret Key', 'Store LINE Pay Channel Secret Key', '店舗 LINE Pay Channel Secret Key', '매장 LINE Pay Channel Secret Key'],
  ['收銀員專屬 PIN (4~8碼)', 'Cashier Staff PIN (4-8 digits)', 'レジ担当専用PIN (4〜8桁)', '캐셔 전용 PIN (4~8자리)'],
  ['例如：1234', 'e.g. 1234', '例：1234', '예: 1234'],
  ['王店長, 小明, 小美', 'Manager Wang, Alex, Amy', '山田店長, 佐藤, 鈴木', '김점장, 민수, 지영'],
  ['櫃檯收據與錢箱機', 'Counter Receipt & Drawer', 'レジレシート・ドロアー機', '카운터 영수증 & 현금서랍기'],
  ['廚房熱菜工單機', 'Kitchen Hot-Line Printer', 'キッチン調理伝票機', '주방 조리표 프린터'],
  ['飲料/貼紙機', 'Drink / Label Printer', 'ドリンク・ラベル機', '음료/라벨 프린터'],
  ['未配對（降級為瀏覽器列印）', 'Unpaired (Browser print fallback)', '未接続（ブラウザ印刷に切替）', '미연결 (브라우저 인쇄로 전환)'],
  ['未配對 (降級為瀏覽器列印)', 'Unpaired (Browser print fallback)', '未接続（ブラウザ印刷に切替）', '미연결 (브라우저 인쇄로 전환)'],
  ['事由 (如: 買冰塊、買塑膠袋)', 'Reason (e.g. ice, plastic bags)', '用途（例：氷、レジ袋購入）', '사유 (예: 얼음, 비닐봉투 구매)'],
  ['單價 ($) *', 'Price ($) *', '単価 ($) *', '단가 ($) *'],
  ['預設無色', 'Default (No color)', 'デフォルト（無色）', '기본 (색상 없음)'],
  ['英文 / 國際菜名 (選填，供外籍生切換英文/日韓介面顯示)', 'English / International Name (Optional, for EN/JA/KO UI)', '英語・国際メニュー名（任意・外国語表示用）', '영문 / 국제 메뉴명 (선택, 외국어 UI용)'],
  ['套用範本:', 'Presets:', 'テンプレート:', '템플릿 적용:'],

  // ---- Header / Cart / Ticket / My Orders / Lookup / LINE Bind / AI Advisor ----
  ['最後同步時間', 'Last synced', '最終同期', '마지막 동기화'],
  ['點擊立即同步雲端資料', 'Tap to sync cloud now', 'タップしてクラウド同期', '클라우드 즉시 동기화'],
  ['開啟今日錢箱交班日結單', 'Open daily shift Z-report', '本日のシフト精算書を開く', '오늘 교대 마감 정산서 열기'],
  ['立即銷毀時效憑證並鎖定後台', 'Revoke session and lock POS', '認証を破棄してロック', '세션 종료 및 POS 잠금'],
  ['安全鎖定並卸載店家後台節點', 'Lock and unload POS session', '安全にロックする', '안전하게 POS 잠금'],
  ['開啟顧客叫號大螢幕看板', 'Open Customer TV Call Board', '呼出大画面ボードを開く', '고객 호출 대형 전광판 열기'],
  ['確認購物車明細與預訂設定', 'Review Cart & Pickup Options', 'カート内容と受取設定の確認', '장바구니 내역 및 픽업 설정 확인'],
  ['查看購物車・選取餐與預訂時間', 'View Cart & Pickup Time', 'カートを見る・受取時間選択', '장바구니 보기・픽업 시간 선택'],
  ['櫃檯收銀數字鍵盤', 'POS Cash Numpad', 'レジ現金テンキー', 'POS 현금 숫자 키패드'],
  ['點選輸入顧客實收金額', 'Enter Cash Tendered', 'お預かり金額を入力', '고객 수령 금액 입력'],
  ['ISO/IEC 18004 光學條碼核銷', 'ISO/IEC 18004 Optical QR Verification', 'ISO/IEC 18004 QRコード検収', 'ISO/IEC 18004 QR 코드 인증'],
  ['掃描顧客電子取餐憑證 QR Code', 'Scan Customer Pickup QR Code', 'お客様の受取QRコードをスキャン', '고객 픽업 QR 코드 스캔'],
  ['廚房出單小票與日結單預覽', '80mm Ticket & Z-Report Preview', '80mm伝票・精算書プレビュー', '80mm 영수증・마감 정산 미리보기'],
  ['櫃檯掛單暫存佇列', 'Counter Held Orders Queue', '一時保留リスト', '카운터 보류 주문 목록'],
  ['暫存掛單清單（隨時取回結帳）', 'Held Orders (Resume Anytime)', '保留注文一覧（いつでも再開可）', '보류 주문 목록 (언제든 결제 재개)'],
  ['未完成訂單修改與單品作廢', 'Modify Active Order / Void Item', '注文内容の変更・単品取消', '진행 주문 수정 / 단품 취소'],
  ['改單 / 單品作廢', 'Edit Order / Void Item', '注文修正 / 単品取消', '주문 수정 / 단품 취소'],
  ['行動支付線上結帳收銀台', 'Online Mobile Payment Checkout', 'モバイル決済チェックアウト', '모바일 온라인 결제창'],
  ['LINE Pay 付款確認', 'LINE Pay Payment Confirmation', 'LINE Pay 決済確認', 'LINE Pay 결제 확인'],
  ['雲端 HMAC 時效簽章驗證 (4碼)', 'Cloud HMAC Session Auth (PIN)', 'クラウドHMAC認証 (PIN)', '클라우드 HMAC 세션 인증 (PIN)'],
  ['店家營運管理授權驗證', 'Merchant Operations Authorization', '店舗管理システム認証', '매장 운영 관리 권한 인증'],
  ['返回點餐頁', 'Back to Ordering', '注文ページへ戻る', '주문 화면으로 돌아가기'],
  ['MealFlow 系統確認', 'MealFlow Confirmation', 'MealFlow システム確認', 'MealFlow 시스템 확인'],
  ['請確認操作', 'Confirm Action', '操作の確認', '작업 확인'],
  ['應付總計金額', 'Total Due', 'お支払い合計', '총 결제 금액'],
  ['防偽動態電子取餐憑證', 'Verified Live Pickup Ticket', '偽造防止リアルタイム受取チケット', '위조 방지 실시간 픽업 티켓'],
  ['您的專屬取餐流水號', 'Your Pickup Number', 'お客様の受取番号', '고객님의 픽업 번호'],
  ['廚房正為您製作餐點中', 'Kitchen is preparing your order', 'ただいまキッチンで調理中です', '주방에서 메뉴를 조리 중입니다'],
  ['伺服器 HMAC 簽章防偽核銷碼', 'Server HMAC Verification Code', 'サーバー署名済み認証コード', '서버 HMAC 위조 방지 인증코드'],
  ['領餐時請供店員掃描下方 QR Code 或核對此 6 碼', 'Show QR below or this 6-char code at counter when picking up', '受取時に下のQRコードまたは6桁コードをご提示ください', '픽업 시 아래 QR 코드 또는 6자리 인증코드를 보여주세요'],
  ['ISO/IEC 18004 標準追蹤與核銷條碼', 'ISO/IEC 18004 Tracking & Verification QR', 'ISO/IEC 18004 追跡・認証QRコード', 'ISO/IEC 18004 추적 및 인증 QR'],
  ['顧客追蹤 & 櫃檯核銷 QR Code', 'Order Tracking & Counter Verify QR', '注文追跡 & 店頭認証QRコード', '주문 추적 & 카운터 확인 QR'],
  ['手機相機直接掃描即可', 'Scan with phone camera to ', 'スマホカメラでスキャンすると', '휴대폰 카메라로 스캔하면 '],
  ['開啟此訂單即時追蹤網頁', 'open live order tracking', 'この注文の追跡ページが開きます', '실시간 주문 추적 페이지가 열립니다'],
  ['；取餐時出示供店家平板鏡頭或掃碼槍掃描即可秒速核銷。', '; show at counter for instant QR scan pickup.', '。受取時に店頭で提示すると即座に検収されます。', '. 픽업 시 카운터에서 스캔하여 즉시 수령하세요.'],
  ['訂單狀態歷程時間軸', 'Order Status Timeline', '注文ステータス履歴', '주문 상태 타임라인'],
  ['訂單成立並送入廚房', 'Order confirmed & sent to kitchen', '注文確定・キッチンへ送信', '주문 접수 및 주방 전달'],
  ['綁定取餐推播通知', 'Link Pickup Push Alerts', '受取プッシュ通知連携', '픽업 알림 연동'],
  ['綁定取餐推播', 'Link Alerts', '通知連携', '알림 연동'],
  ['推播已綁定', 'Alerts Linked', '通知連携済', '알림 연동됨'],
  ['目前叫號', 'Now Calling', '呼出中', '현재 호출'],
  ['前方等候', 'Ahead of You', '待ち件数', '앞 대기'],
  ['預估剩餘', 'Est. Wait', '予想残り', '예상 대기'],
  ['已接單', 'Confirmed', '受付済', '접수됨'],
  ['排程候鍋', 'Scheduled', '予約待機', '예약 대기'],
  ['廚房製作', 'Preparing', '調理中', '조리 중'],
  ['叫號取餐', 'Pickup', '受取呼出', '호출 픽업'],
  ['訂單憑證：', 'Order ID: ', '注文ID: ', '주문번호: '],
  ['下單時間：', 'Ordered: ', '注文時刻: ', '주문시각: '],
  ['手機末碼：', 'Phone last 3: ', '携帯下3桁: ', '전화 뒤 3자리: '],
  ['總計金額', 'Total', '合計金額', '총 금액'],
  ['取餐時段：', 'Pickup Slot: ', '受取時間枠: ', '픽업 시간: '],
  ['支援雙重驗證跨裝置安全找回', 'Secure 2-factor cross-device lookup', '2要素認証で他端末から安全に照会', '2단계 인증으로 다른 기기 주문 찾기'],
  ['我的點餐紀錄與跨裝置訂單查詢', 'My Orders & Cross-Device Lookup', '注文履歴・他端末注文照会', '내 주문 내역 및 다른 기기 조회'],
  ['MealFlow 跨裝置查單', 'MealFlow Order Lookup', 'MealFlow 注文照会', 'MealFlow 주문 조회'],
  ['找回電子取餐憑證', 'Find Electronic Pickup Ticket', '電子受取チケットを照会', '전자 픽업 티켓 찾기'],
  ['LINE 官方帳號與電子信箱即時通知', 'LINE Official Account & Email Alerts', 'LINE公式アカウント・メール即時通知', 'LINE 공식 계정 및 이메일 실시간 알림'],
  ['一鍵透過 LINE 帳號授權綁定', '1-Tap LINE Account Link', 'LINEアカウントでワンタップ連携', 'LINE 계정 원클릭 연동'],
  ['點擊下方按鈕將跳轉至 LINE 官方授權畫面。當餐點製作完成或預訂需繳費時，雲端伺服器將自動推播通知卡給您！', 'Tap below to sign in with LINE. You will receive automatic push alerts when your meal is ready!', '下のボタンからLINE認証を行うと、出来上がり時に自動でプッシュ通知が届きます！', '아래 버튼으로 LINE 인증을 완료하면 음식이 준비될 때 자동으로 푸시 알림을 보내드립니다!'],
  ['使用 LINE 帳號一鍵授權綁定', 'Link with LINE Account', 'LINEアカウントで連携する', 'LINE 계정으로 연동하기'],
  ['綁定電子信箱免費取餐通知 / 或手動填入識別碼', 'Link Email for Free Alerts / Manual ID', 'メール通知登録 / 手動ID入力', '이메일 무료 알림 등록 / 수동 ID 입력'],
  ['電子信箱 (推薦綁定)', 'Email Address (Recommended)', 'メールアドレス（推奨）', '이메일 주소 (권장)'],
  ['LINE 識別碼 (選填，若已用上方按鈕授權會自動帶入)', 'LINE User ID (Optional, auto-filled after login)', 'LINEユーザーID（任意・認証後自動入力）', 'LINE ID (선택, 위 인증 시 자동 입력)'],
  ['U開頭之 33 碼識別碼', '33-char ID starting with U', 'Uで始まる33文字のID', 'U로 시작하는 33자리 ID'],
  ['儲存通知設定', 'Save Notification Settings', '通知設定を保存', '알림 설정 저장'],
  ['開啟網頁震動響鈴', 'Enable Browser Chime & Vibrate', 'ブラウザ通知・バイブを有効化', '브라우저 진동・알림음 켜기'],
  ['最近推播紀錄匣', 'Recent Notification Log', '最近の通知履歴', '최근 알림 기록'],
  ['顯示名稱', 'Display Name', '表示名', '표시 이름'],
  ['例如：王小明', 'e.g. Alex Chen', '例：山田太郎', '예: 김민수'],
  ['MealFlow 智慧選餐與免排隊助手', 'MealFlow Smart Meal & Fast-Lane Advisor', 'MealFlow AIメニュー・時短アシスタント', 'MealFlow 스마트 메뉴・빠른 픽업 도우미'],
  ['依即時排隊狀況幫你快速選餐', 'Smart meal picks based on live wait times', 'リアルタイムの混雑状況から最適な一品を提案', '실시간 대기 현황 기반 빠른 메뉴 추천'],
  ['10分鐘內快取', 'Under 10 min', '10分以内受取', '10분 내 빠른 픽업'],
  ['100元內超值', 'Under NT$100', 'NT$100以下', 'NT$100 이하 가성비'],
  ['高蛋白大份量', 'High Protein', '高タンパク満腹', '고단백 푸짐한 양'],
  ['辣味免排隊', 'Spicy & Fast', '旨辛・待ちなし', '매콤 & 빠른 픽업'],
  ['輸入想吃的口味、預算或「哪家最快？」...', 'Ask cravings, budget, or "Which is fastest?"...', '食べたい味・予算や「一番早い店は？」を入力...', '원하는 맛, 예산 또는 "어디가 가장 빨라?" 입력...'],

  // ---- Merchant POS & Two-Step Checkout ----
  ['送出 ESC/POS 開錢箱指令', 'Send ESC/POS open cash drawer command', 'ESC/POSドロアー開放コマンド送信', 'ESC/POS 현금 서랍 열기 명령'],
  ['一鍵切換售罄或上架狀態', '1-tap toggle Sold Out / Available', 'ワンタップで売切れ・販売中切替', '원클릭 품절/판매 전환'],
  ['櫃檯點餐單', 'Counter Ticket', 'レジ注文票', '카운터 주문서'],
  ['進階選項（預訂 / 折讓 / 備註 / 電話 / 統編）', 'More Options (Pre-order / Discount / Note / Phone)', '詳細オプション（予約・割引・メモ・電話）', '추가 옵션 (예약 / 할인 / 메모 / 전화)'],
  ['櫃檯收銀確認・多元付款找零', 'Counter Checkout & Multi-Pay Change', 'レジ会計確認・お釣り計算', '카운터 결제 확인 및 거스름돈'],
  ['選擇收款方式（支援現金、行動支付與複合付款）', 'Payment Method (Cash, LINE Pay & Split Pay)', 'お支払い方法（現金・LINE Pay・併用払い）', '결제 수단 (현금・LINE Pay・복합 결제)'],
  ['確認收款並立即出單', 'Confirm Payment & Print', '会計確定・発券', '결제 확인 및 출식'],
  ['顧客實收現金', 'Cash Tendered', 'お預かり現金', '받은 현금'],
  ['應找零錢', 'Change Due', 'お釣り', '거스름돈'],
  ['應收總計', 'Total Due', '合計金額', '총 결제 금액'],
  ['現場立即製作', 'Make Immediately', '即時調理', '즉시 조리'],

  // ---- Merchant KDS Orders ----
  ['即時廚房爐上備料與規格拆解看板 (All-Day Batch View)', 'Live Kitchen Batch Prep & Spec Breakdown', 'リアルタイム厨房調理集計ボード', '실시간 주방 조리 합계 및 옵션 분류'],
  ['同時顯示主餐總數與飯量/辣度/內外帶拆解，方便師傅批次下鍋盛飯', 'Aggregates total counts with portion/spice/takeout breakdown for fast batch cooking', '主菜数とご飯量・辛さ・店内/持帰内訳を一括表示しバッチ調理を支援', '메인 수량과 밥 양/맵기/포장 내역을 한눈에 집계하여 빠른 조리 지원'],
  ['櫃檯快速核銷取餐：', 'Quick Counter Pickup Verify: ', '店頭スピード検収：', '카운터 빠른 픽업 확인: '],
  ['支援鏡頭掃描顧客 QR 憑證，或輸入 6 碼防偽核銷碼（未收款將自動彈出收銀視窗）', 'Scan customer QR or enter 6-char code (unpaid orders auto-open payment modal)', '顧客QRスキャンまたは6桁認証コード入力（未会計は自動でレジ画面を表示）', '고객 QR 스캔 또는 6자리 코드 입력 (미결제 시 자동으로 수금 창 표시)'],
  ['開啟鏡頭掃碼', 'Scan QR Camera', 'カメラQRスキャン', '카메라 QR 스캔'],
  ['輸入6碼防偽碼或取餐號', 'Enter 6-char code or Pickup #', '6桁認証コードまたは受取番号', '6자리 코드 또는 픽업번호 입력'],
  ['核銷取餐', 'Verify & Complete', '検収完了', '픽업 확인'],
  ['新單語音播報：開', 'New Order Voice: ON', '新規注文音声：ON', '신규 주문 음성: 켜짐'],
  ['新單語音播報：關', 'New Order Voice: OFF', '新規注文音声：OFF', '신규 주문 음성: 꺼짐'],
  ['搜尋電話、核銷碼或單號...', 'Search phone, verify code, or order #...', '電話番号・認証コード・注文番号で検索...', '전화번호, 인증코드, 주문번호 검색...'],
  ['預訂待發送', 'Scheduled', '予約待機', '예약 대기'],
  ['待收款確認', 'Unpaid', '未会計', '미결제'],
  ['已通知待取餐', 'Ready for Pickup', '呼出済・受取待', '호출됨・픽업 대기'],
  ['已完成/已退單', 'Completed / Void', '完了・取消', '완료 / 취소'],
  ['廚房分站過濾：', 'Kitchen Station: ', 'キッチン担当：', '주방 파트 필터: '],
  ['全部站點', 'All Stations', '全ステーション', '전체 파트'],
  ['主食飯麵 (MAIN)', 'Mains (MAIN)', '主食 (MAIN)', '메인 (MAIN)'],
  ['炸物小菜 (SIDE)', 'Sides (SIDE)', 'サイド (SIDE)', '사이드 (SIDE)'],
  ['湯品飲品 (DRINK)', 'Drinks (DRINK)', 'ドリンク (DRINK)', '음료 (DRINK)'],
  ['主食飯麵', 'Mains', '主食', '메인'],
  ['炸物小菜', 'Sides', 'サイド', '사이드'],
  ['湯品飲品', 'Drinks', 'ドリンク', '음료'],
  ['自動偵測 (AUTO)', 'Auto Detect (AUTO)', '自動判定 (AUTO)', '자동 감지 (AUTO)'],
  ['排序：', 'Sort: ', '並び順：', '정렬: '],
  ['最緊急優先 (FIFO)', 'Most Urgent (FIFO)', '緊急度順 (FIFO)', '긴급 우선 (FIFO)'],
  ['最新下單優先', 'Newest First', '新着順', '최신 주문순'],
  ['線上單', 'Online', 'オンライン', '온라인'],
  ['點擊單品逐項劃單出餐', 'Tap items to check off as prepared', '品目をタップして調理済チェック', '메뉴를 탭하여 조리 완료 체크'],
  ['小票/工單', 'Receipt / Ticket', 'レシート・伝票', '영수증/주방표'],
  ['#12 改單或單品作廢', 'Modify order or void single item', '注文変更・単品取消', '주문 수정 또는 단품 취소'],
  ['#37 傳送即時留言至顧客取餐單', 'Send live message to customer ticket', '顧客チケットへメッセージ送信', '고객 티켓에 실시간 메시지 전송'],
  ['收款並結單', 'Collect & Complete', '会計して完了', '수금 및 완료'],
  ['櫃檯訂單收款與防呆結帳', 'Counter Order Payment & Change', '店頭注文会計・お釣り計算', '카운터 주문 수금 및 결제'],
  ['訂單收款與觸控找零', 'Order Payment & Change Calculator', '注文会計・お釣り計算', '주문 결제 및 거스름돈 계산'],
  ['應收金額', 'Amount Due', '請求金額', '결제 금액'],
  ['實收現金', 'Cash Tendered', 'お預かり現金', '받은 현금'],

  // ---- Merchant Analytics ----
  ['商業會計損益與真實訂單分析', 'Accounting P&L & Real Order Analytics', '会計損益・リアルタイム売上分析', '회계 손익 및 실시간 주문 분석'],
  ['嚴格區分「今日逐時」、「過去 7 日趨勢」與「應收/實收帳款」，絕不混入未來預訂單造成帳務失真。', 'Strictly separates Today Hourly, 7-Day Trend, and Paid vs Receivable without mixing future pre-orders.', '「本日時間帯別」「過去7日推移」「実収・未収」を厳格に分離し、未来予約による売上誤差を防止します。', '오늘 시간별, 최근 7일 추이, 실수금/미수금을 엄격히 구분하여 향후 예약으로 인한 왜곡을 방지합니다.'],
  ['過去7日趨勢', 'Past 7 Days', '過去7日推移', '최근 7일 추이'],
  ['匯出 CSV', 'Export CSV', 'CSV出力', 'CSV 내보내기'],
  ['實收淨營業額 (Net Paid)', 'Net Paid Revenue', '実収純売上 (Net Paid)', '실수금 순매출 (Net Paid)'],
  ['毛銷售額 vs 折扣讓利成本', 'Gross Sales vs Discount Cost', '総売上 vs 割引コスト', '총매출 vs 할인 비용'],
  ['未收應收帳款 & 未來預訂', 'Receivables & Future Pre-orders', '未収売掛金・未来予約', '미수금 및 향후 예약'],
  ['目前即時出餐等候 / 產能負載', 'Live Prep Wait / Capacity Load', '現在の待ち時間・稼働率', '현재 대기 시간 / 생산 부하'],
  ['今日各時段真實實收營收', "Today's Hourly Paid Revenue", '本日の時間帯別実収売上', '오늘 시간대별 실수금 매출'],
  ['點擊柱狀圖篩選明細', 'Click bar to filter orders', '棒グラフをクリックして絞り込み', '막대 클릭 시 내역 필터'],
  ['結構化單品營收佔比 (正規化 baseName)', 'Item Revenue Share Breakdown', '商品別売上構成比', '메뉴별 매출 점유율'],
  ['各時段 15 分鐘尖峰密度與候餐時間曲線', '15-Min Peak Load & Wait Curve', '時間帯別15分ピーク密度・待ち時間曲線', '시간대별 15분 피크 밀도 및 대기 곡선'],
  ['紅虛線：15分鐘警戒', 'Red dashed: 15m alert', '赤破線：15分警戒ライン', '빨간 점선: 15분 경고'],
  ['商業財務與廚房排程診斷', 'Finance & Kitchen Schedule Insights', '財務・キッチン稼働診断', '재무 및 주방 스케줄 진단'],
  ['本區間人氣王備料建議：', 'Top Seller Prep Insight:', '期間内トップセラー仕込み提案：', '기간 인기 1위 준비 제안:'],
  ['銷量第一名為「', 'Best seller is "', '売上1位は「', '판매 1위 메뉴는 "'],
  ['」（售出 ', '" (sold ', '」（販売数 ', '" (판매 '],
  ['未來預訂排程與配額隔離保護：', 'Future Pre-Order & Quota Isolation:', '未来予約スケジュール・枠分離保護：', '향후 예약 스케줄 및 정원 격리 보호:'],
  ['系統共有 ', 'There are ', '現在 ', '현재 '],
  ['，已全數納入 15 分鐘時段配額控管並置於「已接單待排程」狀態，不會提前擠佔今日廚房佇列或污染今日營收。', ', protected by 15m slot quotas in Scheduled state so they never crowd today\'s kitchen or revenue.', ' あり、15分枠で管理され本日のキッチンや売上には混入しません。', '이 15분 정원으로 격리되어 오늘 주방이나 매출에 혼입되지 않습니다.'],
  ['區間真實訂單明細', 'Period Order Details', '期間内注文明細', '기간 주문 상세 내역'],
  ['本區間共 ', 'Total ', '期間合計 ', '기간 총 '],
  [' 筆訂單', ' orders', ' 件の注文', '건의 주문'],

  // ---- Shift Z-Report & Receipt Print ----
  ['80mm 熱感應出單機格式', '80mm Thermal Receipt Format', '80mm サーマルレシート形式', '80mm 감열 영수증 형식'],
  ['櫃檯錢箱交班日結單 (全日總結)', 'Counter Cash Drawer Z-Report (Full Day)', 'レジ精算書 (終日集計)', '카운터 교대 마감 정산서 (종일)'],
  ['櫃檯錢箱交班日結單 (預覽)', 'Cash Drawer Z-Report (Preview)', 'レジ精算書 (プレビュー)', '교대 마감 정산서 (미리보기)'],
  ['多班別錢箱清點・中途零用金收支與關班鎖定', 'Multi-Shift Drawer Count, Petty Cash & Shift Lock', 'マルチシフト精算・小口現金・締めロック', '다중 교대 시재 점검・소액 현금 및 마감 잠금'],
  ['開店找零零用金 ($)', 'Opening Float ($)', '開店釣銭準備金 ($)', '개시 시재금 ($)'],
  ['開店找零準備金 (零用金)', 'Opening Float (Petty Cash)', '開店釣銭準備金', '개시 시재 준비금'],
  ['櫃檯實際清點現金 ($)', 'Actual Cash Counted ($)', '実査現金合計 ($)', '실제 시재 현금 ($)'],
  ['櫃檯實際清點現金', 'Actual Cash Counted', '実査現金合計', '실제 시재 현금'],
  ['交班收銀員姓名', 'Cashier Name', '担当レジ氏名', '교대 캐셔 이름'],
  ['如：王店長 / 早班', 'e.g. Alex / Morning Shift', '例：山田店長 / 早番', '예: 김점장 / 오전 근무'],
  ['中途零用金收支登記（如：買冰塊、買免洗袋、採買食材或臨時補零錢，自動計入錢箱應有現金）', 'Mid-Shift Petty Cash Log (e.g. ice, bags, supplies or float top-up; auto-adjusted in expected cash)', '途中入出金記録（氷・袋・食材購入や釣銭補充など、理論現金に自動反映）', '근무 중 소액 현금 입출금 (얼음, 봉투, 재료 구매 등 예상 현금 자동 반영)'],
  ['事由 (如：買冰塊、買塑膠袋)', 'Reason (e.g. ice, plastic bags)', '用途（例：氷、レジ袋購入）', '사유 (예: 얼음, 비닐봉투 구매)'],
  ['錢箱支出 (-$)', 'Cash Out (-$)', '出金 (-$)', '현금 지출 (-$)'],
  ['錢箱補入 (+$)', 'Cash In (+$)', '入金 (+$)', '현금 입금 (+$)'],
  ['金額 ($)', 'Amount ($)', '金額 ($)', '금액 ($)'],
  ['＋ 登記', '+ Record', '＋ 記録', '＋ 등록'],
  ['今日尚無中途零用金支出或補入紀錄', 'No mid-shift petty cash entries today', '本日の途中入出金記録はありません', '오늘 소액 현금 입출금 기록이 없습니다'],
  ['確認完成本班日結並鎖定當日帳務 (防篡改)', 'Confirm & Lock Shift Z-Report (Tamper-Proof)', 'シフト精算を確定してロックする', '교대 정산 확정 및 당일 장부 잠금'],
  ['營業收款日：', 'Business Date: ', '営業日：', '영업 정산일: '],
  ['出表時間：', 'Generated: ', '作成時刻：', '발행 시각: '],
  ['當日收款單數：', 'Paid Orders Today: ', '当日会計件数：', '당일 결제 건수: '],
  ['【一、當日收款損益與代收費用拆解】', '[1. Daily Paid Revenue & Fee Breakdown]', '【1. 当日売上・手数料内訳】', '[1. 당일 결제 손익 및 수수료 내역]'],
  ['餐點商品毛銷售額', 'Gross Item Sales', '商品総売上', '메뉴 총매출'],
  ['一次性環保餐具費', 'Disposable Cutlery Fee', 'カトラリー料金', '일회용 수저 요금'],
  ['離峰分流折扣讓利', 'Off-Peak Promo Discounts', 'オフピーク割引額', '할인 프로모션 비용'],
  ['櫃檯手動折讓/招待', 'Counter Discounts / Comps', '店頭割引・サービス', '카운터 수동 할인/무료'],
  ['當日實收淨營業額', 'Daily Net Paid Revenue', '当日実収純売上', '당일 실수금 순매출'],
  ['【二、錢箱現金收付與盤點核對】', '[2. Cash Drawer Reconciliation]', '【2. 現金ドロアー精査・照合】', '[2. 현금 시재 수불 및 점검]'],
  ['現金交易顧客實收總額', 'Total Cash Tendered', '現金お預かり合計', '현금 거래 받은 총액'],
  ['現金交易找零總額', 'Total Change Given', '現金お釣り合計', '현금 거래 거스름돈 총액'],
  ['現金已收後退單退款', 'Cash Refunds (Post-Pay Void)', '現金返金額', '현금 결제 후 환불'],
  ['現金營業淨入帳', 'Net Cash Sales', '現金純売上', '현금 영업 순입금'],
  ['錢箱應有現金總額 (含零用金收支)', 'Expected Drawer Cash (incl. Petty Cash)', '理論ドロアー現金（入出金込）', '예상 시재 총액 (소액현금 포함)'],
  ['盤點差額 (短溢)', 'Drawer Variance (Over/Short)', '過不足差額', '시재 차액 (과부족)'],
  ['【三、行動支付與無現金清點】', '[3. Digital & Cashless Payments]', '【3. キャッシュレス決済集計】', '[3. 모바일 및 비현금 결제]'],
  ['LINE Pay 當日入帳', 'LINE Pay Settled Today', 'LINE Pay 当日入金', 'LINE Pay 당일 입금'],
  ['非現金支付小計', 'Cashless Subtotal', 'キャッシュレス小計', '비현금 결제 소계'],
  ['【四、退款、作廢與跨日預收履約對帳】', '[4. Refunds, Voids & Cross-Day Reconciliation]', '【4. 返金・取消・日跨ぎ予約照合】', '[4. 환불・취소 및 타일 예약 대조]'],
  ['今日待收款訂單', 'Unpaid Orders Today', '本日未会計注文', '오늘 미결제 주문'],
  ['已付款後退單退款', 'Refunded Paid Orders', '支払済キャンセル返金', '결제 후 취소 환불'],
  ['未收款取消作廢', 'Unpaid Voided Orders', '未会計キャンセル', '미결제 취소 무효'],
  ['跨日預收今日取餐', 'Prior-Day Prepaid Pickups Today', '前日以前支払・本日受取', '전일 선결제 오늘 픽업'],
  ['不重複入錢箱', 'Not re-counted in drawer', 'ドロアー重複計上なし', '시재 중복 미포함'],
  ['值班收銀員簽名：', 'Cashier Signature: ', 'レジ担当署名：', '근무 캐셔 서명: '],
  ['店長覆核簽名：', 'Manager Sign-off: ', '店長承認署名：', '점장 확인 서명: '],
  ['立即列印 80mm 單據', 'Print 80mm Receipt Now', '80mm レシートを印刷', '80mm 영수증 즉시 인쇄'],
  ['顧客收據與追蹤 QR 憑證聯 (80mm)', 'Customer Receipt & Tracking QR (80mm)', '顧客レシート・追跡QR伝票 (80mm)', '고객 영수증 및 추적 QR (80mm)'],
  ['顧客收據聯', 'Customer Receipt', '顧客レシート', '고객 영수증'],
  ['廚房大字工單', 'Kitchen Work Ticket', 'キッチン大文字伝票', '주방 대형 조리표'],
  ['餐盒貼紙聯', 'Box Sticker Labels', '弁当ラベルシール', '포장 스티커 라벨'],
  ['80mm 顧客收據聯', '80mm Customer Receipt', '80mm 顧客レシート', '80mm 고객 영수증'],
  ['餐具：自備環保餐具 ($0)', 'Cutlery: Eco / No Cutlery ($0)', 'カトラリー：不要 ($0)', '수저: 미필요 ($0)'],
  ['聯絡電話：', 'Phone: ', '電話番号：', '연락처: '],
  ['取餐：', 'Pickup: ', '受取：', '픽업: '],
  ['實收總計', 'Total Paid', '合計金額', '총 결제액'],
  ['手機掃碼即時看叫號進度 & 取餐通知', 'Scan QR for Live Status & Pickup Alerts', 'スマホでスキャンして進行状況・呼出通知を確認', 'QR 스캔으로 실시간 진행 및 픽업 알림 확인'],
  ['免站櫃檯久候！相機掃描上方 QR 即可在手機追蹤製作進度與綁定 LINE 響鈴通知', 'Skip waiting at the counter! Scan QR above to track prep status & get alerts on your phone.', '店頭で待つ必要なし！上のQRをスキャンしてスマホで調理状況や通知を確認できます。', '카운터 앞에서 기다리지 마세요! 위 QR을 스캔해 휴대폰으로 조리 현황과 알림을 받으세요.'],
  ['列印時間：', 'Printed: ', '印刷時刻：', '인쇄 시각: '],
  ['謝謝光臨，請憑號碼牌與防偽碼至櫃檯取餐！', 'Thank you! Please show your number & code at counter.', 'ありがとうございます！番号と認証コードで店頭にてお受け取りください。', '감사합니다! 번호와 인증코드를 지참해 카운터에서 픽업하세요.'],

  // ---- Merchant Settings (All 4 Sub-tabs + Menu Edit Modal) ----
  ['菜單管理與智慧照片辨識', 'Menu & AI Photo Scanner', 'メニュー管理・AI読取', '메뉴 관리 및 AI 사진 인식'],
  ['營業狀態・餐具收費與離峰優惠', 'Status, Cutlery & Promos', '営業状態・カトラリー・割引', '영업상태・수저・할인'],
  ['餐廳與校區管理', 'Store Profile & Hours', '店舗情報・営業時間', '매장 정보 및 영업시간'],
  ['推播設定・安全鎖與稽核紀錄', 'Notifications, Security & Logs', '通知・セキュリティ・機器・監査', '알림・보안・장비・감사로그'],
  ['智慧視覺菜單辨識（支援拍照上傳與穩定品項 ID 匯入）', 'AI Visual Menu Scanner (Photo Upload & Stable ID Import)', 'AIビジュアルメニュー読取（写真・安定IDインポート）', 'AI 비주얼 메뉴 인식 (사진 업로드 및 안정 ID 가져오기)'],
  ['上傳紙本菜單照片或貼上文字，系統將自動進行結構化解析並綁定確定性品項 ID，絕不破壞進行中訂單關聯！', 'Upload a menu photo or paste text to auto-parse dishes with stable IDs without breaking active orders.', '紙メニュー写真やテキストから自動解析し、進行中注文に影響しない安定IDで登録します。', '메뉴 사진 업로드 또는 텍스트 붙여넣기로 진행 중 주문에 영향 없이 자동 등록합니다.'],
  ['拍照 / 上傳菜單圖片', 'Take Photo / Upload Menu', 'メニュー写真を撮影・選択', '메뉴 사진 촬영 / 업로드'],
  ['或在此直接貼上菜單文字（例如：招牌牛肉麵 120 (加麵+15/小辣)、紅油抄手 65、燙青菜 40）...', 'Or paste menu text here (e.g. Beef Noodle 120, Dumplings 70)...', 'またはメニュー文字を貼り付け（例：牛肉麺 120、餃子 70）...', '또는 여기에 메뉴 텍스트 붙여넣기 (예: 우육면 120, 만두 70)...'],
  ['執行結構化解析與預覽', 'Parse & Preview Menu', '構造解析・プレビュー実行', '구조화 분석 및 미리보기'],
  ['載入範例新菜單測試', 'Load Sample Menu', 'サンプル読込', '샘플 메뉴 불러오기'],
  ['手動新增單一品項至「', 'Add Single Menu Item to "', '単品メニューを追加：「', '단일 메뉴 추가: "'],
  ['」（自動產生穩定品項 ID・支援每日限量）', '" (Auto Stable ID • Supports Daily Limits)', '」（安定ID自動生成・日次数量限定対応）', '" (안정 ID 자동 생성・일일 한정 지원)'],
  ['如：主廚推薦', "e.g. Chef's Pick", '例：おすすめ', '예: 셰프 추천'],
  ['如：香煎雞腿便當', 'e.g. Crispy Chicken Bento', '例：チキン弁当', '예: 치킨 도시락'],
  ['如：🔥 招牌必點', 'e.g. 🔥 Popular', '例：🔥 看板メニュー', '예: 🔥 인기 메뉴'],
  ['如：🔥 店長推薦', "e.g. 🔥 Manager's Pick", '例：🔥 店長おすすめ', '예: 🔥 점장 추천'],
  ['價格 *', 'Price *', '価格 *', '가격 *'],
  ['每日限量 (0=不限)', 'Daily Limit (0=Unlimited)', '1日限定数 (0=無制限)', '일일 한정 (0=무제한)'],
  ['每日限量', 'Daily Limit', '1日限定数', '일일 한정'],
  ['0=不限', '0=Unlimited', '0=無制限', '0=무제한'],
  ['推薦標籤', 'Tag Badge', 'おすすめタグ', '추천 태그'],
  ['客製選項 (逗號分隔)', 'Options (comma-separated)', 'オプション（カンマ区切り）', '커스텀 옵션 (쉼표 구분)'],
  ['正常, 飯少', 'Regular, Less rice', '普通, ご飯少なめ', '보통, 밥 적게'],
  ['＋ 新增', '+ Add', '＋ 追加', '＋ 추가'],
  ['批次加料售罄開關（點擊一次即同步全店所有含該加料的主餐）', 'Bulk Modifier Sold-Out Toggle (syncs across all dishes using that add-on)', 'トッピング一括売切れ切替（全メニューへ即時反映）', '토핑 일괄 품절 전환 (해당 토핑 포함 전체 메뉴 동기화)'],
  ['營業狀態・基礎出餐時間・預訂備餐前置・餐具與離峰優惠設定', 'Store Status, Prep Time, Auto-Fire Lead, Cutlery & Promos', '営業状態・調理時間・予約自動開始・カトラリー・割引設定', '영업상태・조리시간・예약 투입・수저 및 할인 설정'],
  ['可在此調整每 15 分鐘餐點份數產能上限、預訂單自動推入廚房前置時間與離峰折抵/招待優惠。', 'Configure 15-min portion capacity, pre-order auto-fire lead time, and store promotions.', '15分上限食数、予約自動調理開始時間、各種割引キャンペーンを設定できます。', '15분당 최대 수량, 예약 자동 조리 투입 시간 및 매장 할인 혜택을 설정합니다.'],
  ['正常營業中 (營業時間開放立即製作，打烊後自動開放預訂)', 'Open (Immediate during hours; auto Pre-order when closed)', '営業中（営業時間内は即時・閉店後は自動予約受付）', '정상 영업 중 (영업시간 즉시 조리, 마감 후 자동 예약)'],
  ['「已打烊」會依營業時間自動切換並開放預訂；「暫停營業」則會完全關閉點餐與預訂。', '"Closed" follows store hours & allows pre-orders; "Paused" stops ALL ordering & pre-orders.', '「営業終了」は営業時間に基づき予約受付可、「営業休止」は全注文・予約を停止します。', '"영업 종료"는 영업시간에 따라 예약 가능, "영업 중지"는 모든 주문 및 예약을 중단합니다.'],
  ['行銷優惠模式（三-2 彈性設定）', 'Promotion Mode (Flexible)', 'プロモーション設定', '프로모션 모드 (유연 설정)'],
  ['關閉優惠', 'No Promotion', '割引なし', '할인 끄기'],
  ['滿額贈送指定餐點 / 飲品', 'Free Gift Item on Min Spend', '条件達成で指定品を無料進呈', '최소 금액 달성 시 무료 증정'],
  ['滿額現金現折', 'Instant Cash Discount on Min Spend', '条件達成で現金割引', '최소 금액 달성 시 현금 할인'],
  ['第二件折價 (每 2 件折抵)', '2nd Item Discount (Every 2 items)', '2品目割引（2品ごと）', '2번째 메뉴 할인 (2개당 할인)'],
  ['優惠適用時段', 'Promo Active Hours', '割引適用時間帯', '할인 적용 시간대'],
  ['僅離峰順暢時段適用 (分流專用)', 'Off-Peak / Low-Traffic Only', 'オフピーク時間帯のみ適用', '비혼잡 시간대 전용'],
  ['全天候營業時段皆適用', 'All Open Hours', '全営業時間で適用', '전 영업시간 적용'],
  ['優惠最低消費門檻 (NT$)', 'Promo Min Spend (NT$)', '割引最低利用額 (NT$)', '할인 최소 주문 금액 (NT$)'],
  ['優惠顯示文案', 'Promo Display Banner Text', '割引表示テキスト', '할인 안내 문구'],
  ['例：🎁 滿百贈招牌紅茶', 'e.g. 🎁 Free Iced Tea over $100', '例：🎁 $100以上で紅茶無料', '예: 🎁 $100 이상 아이스티 증정'],
  ['現金折抵 / 第二件折抵金額 (NT$)', 'Discount Amount (NT$)', '割引金額 (NT$)', '할인 금액 (NT$)'],
  ['指定贈品品項（滿額贈送專用・售罄自動停贈）', 'Designated Freebie Item (Auto-pauses if sold out)', '無料進呈品目（売切れ時は自動停止）', '지정 증정 메뉴 (품절 시 자동 중단)'],
  ['（不指定特定品項，依文案顯示）', '(No specific item — display banner text only)', '（指定なし・テキストのみ表示）', '(특정 메뉴 미지정 — 문구만 표시)'],
  ['內用掃碼「餐後結帳」模式（三-3）', 'Dine-in QR "Pay After Meal" Mode', '店内QR「食後会計」モード', '매장 식사 QR "식후 결제" 모드'],
  ['關閉（學生須先付或取餐付現）', 'Off (Prepay or cash at pickup)', 'オフ（事前決済または受取時払い）', '끄기 (선결제 또는 픽업 시 현금)'],
  ['開啟內用餐後至櫃檯結帳', 'Enabled (Dine-in pay at counter after meal)', 'オン（食後カウンター会計を許可）', '켜기 (식사 후 카운터 결제 허용)'],
  ['本店專屬優惠券 / 折扣碼管理（學生於購物車輸入立即核實折抵）', 'Store Coupon & Promo Code Manager (Verified at Checkout)', '店舗クーポン・割引コード管理（会計時自動適用）', '매장 전용 쿠폰 / 할인 코드 관리 (장바구니 즉시 적용)'],
  ['目前尚未建立優惠券（新增後請點下方「儲存設定」）', 'No coupons created yet (Add & click Save below)', 'クーポン未登録（追加後に下の保存を押してください）', '등록된 쿠폰이 없습니다 (추가 후 아래 저장 클릭)'],
  ['儲存營業狀態、行銷優惠與優惠券設定', 'Save Status, Promos & Coupons', '営業状態・割引・クーポン設定を保存', '영업상태・할인・쿠폰 설정 저장'],
  ['折扣碼 *', 'Code *', 'コード *', '할인코드 *'],
  ['如 SCU15', 'e.g. SCU15', '例 SCU15', '예: SCU15'],
  ['類型', 'Type', '種類', '유형'],
  ['折現金 ($)', 'Fixed ($)', '定額割引 ($)', '금액 할인 ($)'],
  ['打折 (% off)', 'Percent (% off)', '割合割引 (% off)', '퍼센트 (% off)'],
  ['面額/折數', 'Value', '割引額/率', '할인액/율'],
  ['低消 ($)', 'Min ($)', '最低額 ($)', '최소금액 ($)'],

  // ---- Settings: storeProfile & line ----
  ['編輯餐廳基本資料・代表圖示・營業時間與公休日', 'Edit Store Profile, Icon, Hours & Closed Days', '店舗基本情報・アイコン・営業時間・定休日設定', '매장 기본정보・아이콘・영업시간 및 휴무일 편집'],
  ['支援動態修改店名、所屬校區、營業時間、午休時段與每週公休日，免改程式碼即可即時更新全站預訂時段！', 'Dynamically update store name, campus, hours, break time, and weekly closed days live!', '店名・キャンパス・営業時間・休憩・定休日を即時更新できます！', '매장명, 캠퍼스, 영업시간, 휴식시간, 정기 휴무일을 실시간으로 변경할 수 있습니다!'],
  ['刪除此餐廳櫃位', 'Delete Store', 'この店舗を削除', '이 매장 삭제'],
  ['所屬校區 (可自由輸入新校區)', 'Campus (custom allowed)', '所属キャンパス', '소속 캠퍼스'],
  ['如：雙溪校區、城中校區', 'e.g. Waishuangxi, Downtown', '例：双渓、城中', '예: 솽시, 청중'],
  ['餐廳名稱 *', 'Store Name *', '店舗名 *', '매장명 *'],
  ['如：趙班長海苔飯捲', "e.g. Capt. Zhao's Kimbap", '例：趙班長キンパ', '예: 조반장 김밥'],
  ['餐點類型標語', 'Cuisine Category', '料理ジャンル', '음식 카테고리'],
  ['如：人氣韓式・飯捲', 'e.g. Korean Kimbap', '例：韓国キンパ', '예: 한식・김밥'],
  ['餐廳代表圖示 (Emoji 或圖片網址)', 'Store Icon (Emoji or Image URL)', '店舗アイコン（絵文字または画像URL）', '매장 아이콘 (이모지 또는 이미지 URL)'],
  ['如：🍙、🍱 或 https://...', 'e.g. 🍙, 🍱 or https://...', '例：🍙・🍱 または https://...', '예: 🍙, 🍱 또는 https://...'],
  ['每日開始營業時間', 'Daily Opening Time', '開店時刻', '매일 영업 시작 시각'],
  ['每日結束營業時間', 'Daily Closing Time', '閉店時刻', '매일 영업 종료 시각'],
  ['午休開始時間 (選填，無午休留空)', 'Break Start (Optional)', '休憩開始（任意）', '브레이크 시작 (선택)'],
  ['午休結束時間 (選填)', 'Break End (Optional)', '休憩終了（任意）', '브레이크 종료 (선택)'],
  ['每週固定公休日 (0=日,6=六，逗號分隔)', 'Weekly Closed Days (0=Sun, 6=Sat)', '毎週定休日 (0=日, 6=土)', '매주 정기 휴무일 (0=일, 6=토)'],
  ['如：0,6 代表週六日公休', 'e.g. 0,6 for Sat & Sun off', '例：0,6 で土日定休', '예: 0,6 (토・일 휴무)'],
  ['儲存餐廳資料與營業時段設定', 'Save Store Profile & Hours', '店舗情報・営業時間を保存', '매장 정보 및 영업시간 저장'],
  ['新增學餐合作餐廳櫃位（須設定獨立店務 PIN 碼）', 'Add New Partner Store (Unique Store PIN Required)', '新規店舗を追加（専用PIN必須）', '신규 제휴 매장 추가 (전용 PIN 필수)'],
  ['所屬校區 *', 'Campus *', 'キャンパス *', '캠퍼스 *'],
  ['新餐廳名稱 *', 'New Store Name *', '新規店舗名 *', '신규 매장명 *'],
  ['如：阿宏鐵板燒', 'e.g. Hong Teppanyaki', '例：鉄板焼き食堂', '예: 철판구이 식당'],
  ['分類說明', 'Category', 'カテゴリ', '카테고리'],
  ['現炒鐵板・簡餐', 'Teppanyaki & Sets', '鉄板焼き・定食', '철판구이・정식'],
  ['圖示', 'Icon', 'アイコン', '아이콘'],
  ['專屬管理 PIN (4~8碼) *', 'Store Manager PIN (4-8 digits) *', '店舗専用PIN (4〜8桁) *', '매장 전용 PIN (4~8자리) *'],
  ['請設定4~8位數字', '4-8 digits', '4〜8桁の数字', '4~8자리 숫자 입력'],
  ['＋ 建立新餐廳', '+ Create Store', '＋ 店舗作成', '＋ 매장 생성'],
  ['官方帳號 + 📧 電子信箱雙軌推播設定', 'LINE OA + Email Dual Push Settings', 'LINE公式 + メール通知設定', 'LINE 공식 + 이메일 알림 설정'],
  ['各店獨立計算每月免費推播額度', 'Separate monthly push quota per store', '店舗ごとに月間無料配信枠を管理', '매장별 월간 무료 알림 할당량 관리'],
  ['使用平台預設官方帳號 (2012260287)', 'Use Platform Default LINE OA (2012260287)', 'プラットフォーム標準LINEを使用', '플랫폼 기본 LINE 계정 사용'],
  ['免設定即可推播，並自動啟用電子信箱備援通知', 'Zero setup needed + automatic email backup alerts', '設定不要で配信可能・メール予備通知も自動有効', '설정 없이 알림 발송 + 이메일 백업 자동 활성화'],
  ['各店獨立 LINE Pay 商家金流串接設定', 'Store-Specific LINE Pay Payment Gateway', '店舗別 LINE Pay 決済設定', '매장별 LINE Pay 결제 연동 설정'],
  ['款項直接入', 'Funds settle directly to ', '売上は直接 ', '결제 대금은 직접 '],
  ['商店帳戶', ' merchant account', ' 店舗口座へ入金', ' 매장 계좌로 입금'],
  ['預設學餐專屬沙盒收銀台', 'Default Sandbox Checkout', '標準サンドボックス決済', '기본 샌드박스 결제'],
  ['已於雲端加密託管 (輸入可更新)', 'Encrypted in cloud (enter to update)', 'クラウド暗号化保存済（入力で更新）', '클라우드 암호화 보관 중 (입력 시 갱신)'],
  ['貼上商家金流 Secret Key', 'Paste LINE Pay Secret Key', 'LINE Pay Secret Keyを貼り付け', 'LINE Pay Secret Key 붙여넣기'],
  ['金流環境模式 (Request ➔ Confirm)', 'Gateway Mode (Request ➔ Confirm)', '決済環境モード', '결제 환경 모드'],
  ['Sandbox 測試環境 / 學餐模擬授權', 'Sandbox Testing Mode', 'Sandbox テスト環境', 'Sandbox 테스트 환경'],
  ['Production 正式環境 (真實扣款 API V3)', 'Production Live Mode (Real API V3)', 'Production 本番環境 (API V3)', 'Production 실제 결제 (API V3)'],
  ['儲存本店 LINE Pay 商家金流與官方帳號推播設定', 'Save LINE Pay & Notification Settings', 'LINE Pay・通知設定を保存', 'LINE Pay 및 알림 설정 저장'],
  ['店務 4 碼安全鎖・平板專屬店鋪綁定與閒置自動上鎖設定', 'Store PIN Lock, Tablet Binding & Auto-Lock', '店舗PIN・端末ロック・自動施錠設定', '매장 PIN 보안・태블릿 고정 및 자동 잠금'],
  ['POS 閒置自動上鎖時間', 'POS Idle Auto-Lock Timeout', 'POS自動ロック時間', 'POS 미사용 자동 잠금 시간'],
  ['閒置 5 分鐘自動上鎖 (高安全性)', 'Auto-lock after 5 min (High Security)', '5分間無操作で自動ロック', '5분 미사용 시 자동 잠금 (고보안)'],
  ['閒置 15 分鐘自動上鎖 (推薦標準)', 'Auto-lock after 15 min (Recommended)', '15分間無操作で自動ロック（推奨）', '15분 미사용 시 자동 잠금 (권장)'],
  ['閒置 30 分鐘自動上鎖', 'Auto-lock after 30 min', '30分間無操作で自動ロック', '30분 미사용 시 자동 잠금'],
  ['閒置 60 分鐘自動上鎖', 'Auto-lock after 60 min', '60分間無操作で自動ロック', '60분 미사용 시 자동 잠금'],
  ['此平板專屬店鋪鎖定模式', 'Bind Tablet to This Store', 'この端末を店舗専用機に設定', '이 태블릿 전용 매장 고정 모드'],
  ['驗證本店舊密碼', 'Verify current PIN', '現在のPINを入力', '현재 PIN 확인'],
  ['輸入新 4~8 位數字 (更新後預設 8888 立即失效)', 'New 4-8 digits (disables default 8888)', '新PIN 4〜8桁（更新後8888は無効化）', '새 4~8자리 숫자 (변경 후 8888 무효)'],
  ['驗證並更新店長密碼', 'Update Manager PIN', '店長PINを更新', '점장 PIN 변경'],
  ['立即上鎖', 'Lock Now', '今すぐロック', '즉시 잠금'],
  ['員工分級權限設定（二-1：收銀員獨立 PIN 與具名打卡名單）', 'Staff Role Permissions (Cashier PIN & Named Roster)', 'スタッフ権限設定（レジ担当PIN・名簿）', '직원 등급 권한 설정 (캐셔 PIN 및 명단)'],
  ['以「收銀員 PIN」登入時僅能收銀點餐與廚房出餐；執行退單退款、大額折讓、查看財務損益或解鎖日結時，將自動彈出「店長 PIN 覆核視窗」。', 'Staff PIN allows POS & KDS only; refunds, high discounts, P&L, and Z-report unlocks require Manager PIN override.', 'レジ担当PINは注文・調理のみ可能。返金・大幅割引・損益閲覧・精算ロック解除時は店長PINが必要です。', '캐셔 PIN은 주문/조리만 가능하며 환불, 고액 할인, 손익 조회, 마감 잠금 해제는 점장 PIN 승인이 필요합니다.'],
  ['具名員工清單（逗號分隔，登入時下拉選取）', 'Named Staff Roster (comma-separated)', 'スタッフ名簿（カンマ区切り）', '직원 명단 (쉼표로 구분)'],
  ['儲存員工權限', 'Save Staff Security', 'スタッフ権限を保存', '직원 권한 저장'],
  ['ESC/POS 熱感應出單機靜默直印 & 錢箱分站派單設定（二-2）', 'ESC/POS Thermal Printer Direct Print & Cash Drawer Routing', 'ESC/POS レシート直印・ドロアー連携設定', 'ESC/POS 영수증 직인쇄 및 현금 서랍 설정'],
  ['支援透過瀏覽器 WebUSB 或 WebSerial 直接連線 80mm / 58mm 熱感印表機，結帳完成自動靜默切紙出單、依廚房站點分流派單並彈開 RJ-11 現金錢箱！', 'Connect 80mm/58mm thermal printers via WebUSB or WebSerial for auto-cut silent printing, station routing & RJ-11 drawer kick!', 'WebUSB/WebSerialで80mm・58mmプリンターに直接接続し、自動カット印刷・分站出力・ドロアー開放に対応！', 'WebUSB/WebSerial로 80mm/58mm 프린터를 직접 연결해 자동 컷 인쇄 및 RJ-11 서랍 열기를 지원합니다!'],
  ['測試出單', 'Test Print', 'テスト印字', '테스트 인쇄'],
  ['店務敏感操作稽核紀錄（雲端 AuditLogs 工作表持久化・含具名人員與店長覆核紀錄）', 'Sensitive Action Audit Logs (Persisted in Cloud AuditLogs Sheet)', '店舗監査ログ（クラウドAuditLogsシート永続保存）', '매장 민감 작업 감사 로그 (클라우드 AuditLogs 영구 저장)'],
  ['尚無敏感操作稽核紀錄', 'No audit log entries yet', '監査ログはまだありません', '감사 로그 기록이 없습니다'],
  ['櫃檯收據與開錢箱', 'Counter Receipt & Cash Drawer', 'レジレシート・ドロアー', '카운터 영수증 & 현금서랍'],
  ['廚房主餐工單機', 'Kitchen Main Printer', 'キッチンメイン印刷機', '주방 메인 프린터'],
  ['飲料吧台標籤機', 'Drink Bar Printer', 'ドリンクバー印刷機', '음료 바 프린터'],
  ['瀏覽器列印', 'Browser Print', 'ブラウザ印刷', '브라우저 인쇄'],
  ['已連線', 'Connected', '接続済', '연결됨'],
  ['未連線', 'Not Connected', '未接続', '미연결'],

  // ---- Menu Edit Modal ----
  ['餐點規格與選項設定', 'Dish Options & Settings', 'メニュー規格・オプション設定', '메뉴 규격 및 옵션 설정'],
  ['編輯餐點與客製化選項', 'Edit Dish & Custom Modifiers', 'メニュー・オプション編集', '메뉴 및 커스텀 옵션 편집'],
  ['人氣/推薦標籤 (選填)', 'Badge Tag (Optional)', 'おすすめタグ（任意）', '추천 태그 (선택)'],
  ['廚房出餐站點（二-3）', 'Kitchen Station', 'キッチン担当ステーション', '주방 조리 파트'],
  ['POS 排序權重', 'POS Sort Order', 'POS表示順', 'POS 정렬 순서'],
  ['越小越前面', 'Lower = First', '小さいほど先頭', '낮을수록 앞배치'],
  ['POS 色塊標記（二-4）', 'POS Tile Color Tag', 'POSカラータグ', 'POS 색상 태그'],
  ['英文 / 國際菜名（選填，供外籍生切換英文/日韓介面顯示）', 'English / International Name (Optional, shown in EN/JA/KO UI)', '英語・国際メニュー名（任意・外国語表示用）', '영문 / 국제 메뉴명 (선택, 외국어 UI 표시용)'],
  ['如：Spicy Kimchi Pork Kimbap', 'e.g. Spicy Kimchi Pork Kimbap', '例：Spicy Kimchi Pork Kimbap', '예: Spicy Kimchi Pork Kimbap'],
  ['餐點實拍照片（支援直接上傳壓縮或貼上圖片網址）', 'Dish Photo (Upload Auto-Compressed or Paste URL)', '料理写真（アップロード自動圧縮またはURL）', '메뉴 사진 (업로드 자동 압축 또는 URL)'],
  ['貼上 https:// 圖片網址或點擊下方上傳', 'Paste https:// image URL or upload below', 'https:// 画像URLを貼り付けまたは下から選択', 'https:// 이미지 URL 붙여넣기 또는 아래 업로드'],
  ['上傳照片 (自動壓縮)', 'Upload Photo (Auto-Compress)', '写真をアップロード', '사진 업로드 (자동 압축)'],
  ['移除照片', 'Remove Photo', '写真を削除', '사진 삭제'],
  ['客製化選項群組設定', 'Custom Modifier Groups', 'カスタムオプション設定', '커스텀 옵션 그룹 설정'],
  ['選項後加 [售罄] 可單獨停售加料', 'Append [Sold Out] to pause a modifier', '選択肢に[売切れ]で個別停止可', '옵션 뒤 [품절] 입력 시 개별 품절'],
  ['＋ 新增選項群組', '+ Add Option Group', '＋ オプショングループ追加', '＋ 옵션 그룹 추가'],
  ['套用範本：', 'Presets: ', 'テンプレート：', '템플릿 적용: '],
  ['飯類標準', 'Rice Std', 'ご飯標準', '밥 기본'],
  ['麵類標準', 'Noodle Std', '麺標準', '면 기본'],
  ['飲品甜冰', 'Drink Ice/Sugar', 'ドリンク甘さ氷', '음료 당도/얼음'],
  ['鍋貼水餃', 'Dumplings', '餃子セット', '만두 세트'],
  ['套餐飲料(巢狀甜冰)', 'Combo Drink (Nested)', 'セット飲物(階層)', '세트 음료(중첩)'],
  ['多數量加料(×N)', 'Multi-Qty Add-on (×N)', '数量指定トッピング(×N)', '다수량 토핑(×N)'],
  ['群組名稱 (如: 主食份量)', 'Group Name (e.g. Rice Portion)', 'グループ名（例：ご飯の量）', '그룹명 (예: 밥 양)'],
  ['必選單選', 'Required Single', '必須単一選択', '필수 단일선택'],
  ['可多選加料', 'Optional Multi-Select', '複数選択可', '다중선택 가능'],
  ['多數量加購 (×N)', 'Multi-Qty Counter (×N)', '数量指定追加 (×N)', '수량 선택 추가 (×N)'],
  ['逗號分隔，加價寫+數字、單品售罄加[售罄]（例：加起司+15, 加溫泉蛋+15[售罄]）', 'Comma-separated, +price, [Sold Out] (e.g. Cheese+15, Egg+15[Sold Out])', 'カンマ区切り、+価格、[売切れ]（例：チーズ+15, 卵+15）', '쉼표 구분, +금액, [품절] (예: 치즈+15, 계란+15)'],
  ['最少必選數 (0=選填)', 'Min Required (0=Optional)', '最小選択数 (0=任意)', '최소 필수 (0=선택)'],
  ['最多可選數 (0=不限)', 'Max Allowed (0=Unlimited)', '最大選択数 (0=無制限)', '최대 선택 (0=무제한)'],
  ['儲存餐點設定並同步雲端', 'Save Dish & Sync Cloud', 'メニューを保存して同期', '메뉴 저장 및 클라우드 동기화'],

  // ---- 安全鎖定畫面 & 常見短語（放於最後作為兜底） ----
  ['店務營運後台受雲端時效憑證保護中', 'Merchant Backoffice Protected by Cloud Session', '店舗管理画面はクラウド認証で保護されています', '매장 백오피스가 클라우드 보안 세션으로 보호 중입니다'],
  ['未持有該店有效 HMAC Session Token 前，系統禁止渲染收銀、退單與營業報表節點。', 'A valid store HMAC session token is required before accessing POS, refunds, or financial reports.', '有効なHMACセッショントークンがない場合、POS・返金・売上帳票は表示されません。', '유효한 HMAC 세션 토큰이 없으면 POS, 환불 및 매출 리포트에 접근할 수 없습니다.'],
  ['輸入店務授權碼驗證', 'Enter Store PIN to Unlock', '店舗PINコードを入力して解除', '매장 PIN 입력 후 잠금 해제'],
  ['目前無準備中單號', 'No orders preparing', '現在調理中の注文はありません', '현재 준비 중인 주문이 없습니다'],
  ['請稍候，餐點完成將立即顯示並語音叫號', 'Ready numbers will appear and be announced here', '出来上がり次第こちらに表示・音声案内されます', '준비가 완료되면 여기에 표시되며 음성 안내됩니다'],
  ['已與雲端資料庫完成同步', 'Synced with cloud database', 'クラウドと同期しました', '클라우드와 동기화되었습니다'],
  ['已恢復正常營業', 'is now OPEN', '営業を再開しました', '정상 영업을 재개했습니다'],
  ['已設為暫停營業', 'is now PAUSED', '営業休止に設定しました', '영업 중지로 설정되었습니다'],
  ['已加入購物車', 'Added to cart', 'カートに追加しました', '장바구니에 담았습니다'],
  ['查看憑證', 'View Ticket', 'チケット表示', '티켓 보기'],
  ['取餐號碼', 'Pickup #', '受取番号', '픽업 번호'],
  ['防偽核銷碼', 'Verify Code', '認証コード', '인증 코드'],
  ['取餐時間', 'Pickup Time', '受取時間', '픽업 시간'],
  ['付款狀態', 'Payment Status', '支払状況', '결제 상태'],
  ['免洗餐具', 'Cutlery', 'カトラリー', '일회용품'],
  ['優惠折抵', 'Discount', '割引', '할인'],
  ['營業時間', 'Hours', '営業時間', '영업시간'],
  ['桌號', 'Table', 'テーブル', '테이블'],
  ['備註', 'Note', 'メモ', '메모'],
  ['折讓', 'Discount', '割引', '할인'],
  ['小計', 'Subtotal', '小計', '소계'],
  ['總計', 'Total', '合計', '합계'],
  ['名稱', 'Name', '名称', '이름'],
  ['分類', 'Category', 'カテゴリ', '카테고리'],
  ['狀態', 'Status', '状態', '상태'],
  ['時間', 'Time', '時間', '시간'],
  ['日期', 'Date', '日付', '날짜'],
  ['校區', 'Campus', 'キャンパス', '캠퍼스'],
  ['店鋪', 'Store', '店舗', '매장'],
  ['店家', 'Store', '店舗', '매장'],
  ['餐廳', 'Store', '店舗', '매장'],
  ['菜單', 'Menu', 'メニュー', '메뉴'],
  ['餐點', 'Items', 'メニュー', '메뉴'],
  ['預訂', 'Pre-order', '予約', '예약'],
  ['櫃檯', 'Counter', 'カウンター', '카운터'],
  ['廚房', 'Kitchen', 'キッチン', '주방'],
  ['現金', 'Cash', '現金', '현금'],
  ['收據', 'Receipt', 'レシート', '영수증'],
  ['憑證', 'Ticket', 'チケット', '티켓'],
  ['單號', 'Order #', '番号', '번호'],
  ['取餐', 'Pickup', '受取', '픽업'],
  ['免費', 'Free', '無料', '무료'],
  ['分鐘', 'min', '分', '분'],
  ['確定', 'OK', '確定', '확인'],
  ['返回', 'Back', '戻る', '뒤로'],
  ['搜尋', 'Search', '検索', '검색'],
  ['篩選', 'Filter', '絞り込み', '필터'],
  ['立即', 'Now', '今すぐ', '즉시']
];

// 精確整句對應表（v25.0 徹底廢除貪婪子字串切碎，杜絕任何「葱Scallion Pancakes」或「Morning Shift收銀」中英夾雜！）
const UI_PHRASE_EXACT_MAP = (() => {
  const map = new Map();
  UI_PHRASE_TRANSLATIONS.forEach(row => {
    if (!row || !row[0]) return;
    const key = String(row[0]).trim();
    if (!key) return;
    map.set(key, row);
  });
  return map;
})();

function translateServerError(rawMsg) {
  const s = String(rawMsg || '').trim();
  const lang = getCurrentAppLang();
  if (!s || lang === 'zh-TW') return s;
  for (let i = 0; i < SERVER_ERROR_PATTERNS.length; i++) {
    const [re, fn] = SERVER_ERROR_PATTERNS[i];
    const m = s.match(re);
    if (m) return fn(m);
  }
  return translateSystemText(s);
}

function translateSystemText(rawText) {
  if (rawText === null || rawText === undefined) return '';
  const orig = String(rawText);
  const lang = getCurrentAppLang();
  if (!orig || lang === 'zh-TW') return orig;
  if (!/[\u4E00-\u9FFF]/.test(orig)) return orig;

  const trimmed = orig.trim();
  const startIdx = orig.indexOf(trimmed);
  const leadingWs = orig.slice(0, startIdx);
  const trailingWs = orig.slice(startIdx + trimmed.length);
  const langIdx = lang === 'en' ? 1 : (lang === 'ja' ? 2 : (lang === 'ko' ? 3 : 0));

  // 1. 完整精確詞典比對（含純前置 Emoji 符號）
  const exactDict = I18N_DICTIONARY[trimmed];
  if (exactDict) {
    const tr = typeof exactDict === 'string' ? exactDict : (exactDict[lang] || exactDict.en || trimmed);
    return `${leadingWs}${tr}${trailingWs}`;
  }
  const exactPhrase = UI_PHRASE_EXACT_MAP.get(trimmed);
  if (exactPhrase) {
    return `${leadingWs}${exactPhrase[langIdx] || exactPhrase[1] || trimmed}${trailingWs}`;
  }

  const emojiPrefixMatch = trimmed.match(/^([^\u4E00-\u9FFFA-Za-z0-9(\[（【]+)\s*(.+)$/);
  if (emojiPrefixMatch) {
    const prefix = emojiPrefixMatch[1].trim();
    const body = emojiPrefixMatch[2].trim();
    const exactBodyDict = I18N_DICTIONARY[body];
    if (exactBodyDict) {
      const tr = typeof exactBodyDict === 'string' ? exactBodyDict : (exactBodyDict[lang] || exactBodyDict.en || body);
      return `${leadingWs}${prefix} ${tr}${trailingWs}`;
    }
    const exactBodyPhrase = UI_PHRASE_EXACT_MAP.get(body);
    if (exactBodyPhrase) {
      return `${leadingWs}${prefix} ${exactBodyPhrase[langIdx] || exactBodyPhrase[1] || body}${trailingWs}`;
    }
  }

  // 2. 完整結構化動態樣式比對（整句錨定，絕不做局部切碎）
  for (let i = 0; i < UI_DYNAMIC_PATTERNS.length; i++) {
    const [re, fn] = UI_DYNAMIC_PATTERNS[i];
    const m = trimmed.match(re);
    if (m) return `${leadingWs}${fn(m)}${trailingWs}`;
  }
  for (let i = 0; i < SERVER_ERROR_PATTERNS.length; i++) {
    const [re, fn] = SERVER_ERROR_PATTERNS[i];
    const m = trimmed.match(re);
    if (m) return `${leadingWs}${fn(m)}${trailingWs}`;
  }

  // 3. 未命中完整詞條時原樣保留（嚴格保護商家自訂菜名、分類與人名，絕不產生中英夾雜！）
  return orig;
}

function trTerm(rawStr) {
  const s = String(rawStr || '').trim();
  const lang = getCurrentAppLang();
  if (!s || lang === 'zh-TW') return s;
  const exact = I18N_DICTIONARY[s];
  if (exact) {
    return typeof exact === 'string' ? exact : (exact[lang] || exact.en || s);
  }
  const exactPhrase = UI_PHRASE_EXACT_MAP.get(s);
  if (exactPhrase) {
    const langIdx = lang === 'ja' ? 2 : (lang === 'ko' ? 3 : 1);
    return exactPhrase[langIdx] || exactPhrase[1] || s;
  }
  const qtyMatch = s.match(/^(.+?)\s*([×x]\s*\d+)$/i);
  if (qtyMatch && I18N_DICTIONARY[qtyMatch[1].trim()]) {
    const baseEntry = I18N_DICTIONARY[qtyMatch[1].trim()];
    const baseTranslated = typeof baseEntry === 'string' ? baseEntry : (baseEntry[lang] || baseEntry.en || qtyMatch[1]);
    return `${baseTranslated} ${qtyMatch[2].replace(/\s+/g, '')}`;
  }
  // 逗號或頓號分隔的多重詞條（如「正常飯量、小辣」）：僅當所有段落皆可精確翻譯時才翻譯
  if (/[、,]/.test(s)) {
    const parts = s.split(/[、,]/).map(p => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      const translatedParts = parts.map(p => {
        const ex = I18N_DICTIONARY[p];
        if (ex) return typeof ex === 'string' ? ex : (ex[lang] || ex.en || p);
        const ep = UI_PHRASE_EXACT_MAP.get(p);
        if (ep) {
          const langIdx = lang === 'ja' ? 2 : (lang === 'ko' ? 3 : 1);
          return ep[langIdx] || ep[1] || p;
        }
        const qm = p.match(/^(.+?)\s*([×x]\s*\d+)$/i);
        if (qm && I18N_DICTIONARY[qm[1].trim()]) {
          const be = I18N_DICTIONARY[qm[1].trim()];
          return `${typeof be === 'string' ? be : (be[lang] || be.en)} ${qm[2].replace(/\s+/g, '')}`;
        }
        return null;
      });
      if (translatedParts.every(Boolean)) return translatedParts.join(', ');
    }
  }
  return s;
}

function trDishName(item) {
  if (!item) return '';
  const lang = getCurrentAppLang();
  const baseName = String(item.baseName || item.name || '').trim();
  if (lang !== 'zh-TW') {
    if (item.nameEn && String(item.nameEn).trim()) {
      return String(item.nameEn).trim();
    }
    const exact = I18N_DICTIONARY[baseName];
    if (exact) {
      return typeof exact === 'string' ? exact : (exact[lang] || exact.en || baseName);
    }
  }
  return baseName;
}

// WeakMap 保存原文，確保切換語系 100% 可逆無損，且完全不使用 MutationObserver
const __mfOrigTextNodeMap = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
const __mfOrigAttrMap = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

function isProtectedFromAutoI18n(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'CODE' || tag === 'PRE') {
    return true;
  }
  if (el.id === 'headerLangSelect') return true;
  if (el.getAttribute && (el.getAttribute('data-no-i18n') === '1' || el.getAttribute('data-dish-name') === '1')) {
    return true;
  }
  if (typeof el.closest === 'function' && el.closest('[data-no-i18n="1"], [data-dish-name="1"]')) {
    return true;
  }
  return false;
}

function translateRenderedSubtree(rootEl) {
  if (typeof document === 'undefined') return;
  const root = rootEl || document.body;
  if (!root) return;
  const lang = getCurrentAppLang();

  const walkNodes = (node) => {
    if (!node) return;
    if (node.nodeType === 1) {
      if (isProtectedFromAutoI18n(node)) return;
      if (node.getAttribute) {
        ['placeholder', 'title'].forEach(attrName => {
          const curVal = node.getAttribute(attrName);
          if (!curVal) return;
          let rec = __mfOrigAttrMap ? __mfOrigAttrMap.get(node) : null;
          if (!rec) {
            rec = {};
            if (__mfOrigAttrMap) __mfOrigAttrMap.set(node, rec);
          }
          if (rec[attrName] === undefined) {
            rec[attrName] = curVal;
          }
          const origAttr = rec[attrName];
          const nextAttr = lang === 'zh-TW' ? origAttr : translateSystemText(origAttr);
          if (nextAttr !== curVal) node.setAttribute(attrName, nextAttr);
        });
      }
      const children = node.childNodes || [];
      for (let i = 0; i < children.length; i++) {
        walkNodes(children[i]);
      }
    } else if (node.nodeType === 3) {
      const parent = node.parentNode;
      if (parent && isProtectedFromAutoI18n(parent)) return;
      const cur = node.nodeValue || '';
      if (!cur.trim()) return;
      let orig = __mfOrigTextNodeMap ? __mfOrigTextNodeMap.get(node) : null;
      if (orig === null || orig === undefined) {
        orig = cur;
        if (__mfOrigTextNodeMap) __mfOrigTextNodeMap.set(node, orig);
      }
      const nextVal = lang === 'zh-TW' ? orig : translateSystemText(orig);
      if (nextVal !== cur) node.nodeValue = nextVal;
    }
  };
  walkNodes(root);
}

// 結構化更新頂部導覽與靜態 HTML 標籤
function syncHeaderLanguageControls() {
  if (typeof document === 'undefined') return;
  const lang = getCurrentAppLang();
  try { document.documentElement.lang = lang; } catch (e) {}

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
    'filter-PROMO': t('離峰優惠', 'Deals', '割引', '할인'),
    'btnOpenOrderLookup': t('🔍 查單', '🔍 Lookup', '🔍 照会', '🔍 조회'),
    'btnOpenAiAdvisor': t('✨ 選餐助手', '✨ Advisor', '✨ おすすめ', '✨ 추천'),
    'btnCampus-雙溪校區': t('雙溪校區', 'Waishuangxi', '双渓', '솽시'),
    'btnCampus-城中校區': t('城中校區', 'Downtown', '城中', '청중'),
    'campusBtn-雙溪校區': `⛰️ ${t('雙溪校區', 'Waishuangxi', '双渓', '솽시')}`,
    'campusBtn-城中校區': `🏙️ ${t('城中校區', 'Downtown', '城中', '청중')}`,
    'headerLineNotifyBtnText': t('綁定通知', 'Alerts', '通知連携', '알림 연동'),
    'headerPickupBoardBtn': `📺 ${t('叫號看板', 'Call Board', '呼出ボード', '호출 전광판')}`,
    'cartSubmitBtn': t('確認送出訂單', 'Place Order', '注文を確定', '주문하기')
  };
  Object.entries(staticTextMap).forEach(([id, txt]) => {
    const el = document.getElementById(id);
    if (el) el.innerText = txt;
  });

  const lineBtnText = document.getElementById('headerLineBtnText');
  if (lineBtnText && typeof state !== 'undefined' && state && state.lineProfile) {
    lineBtnText.innerText = state.lineProfile.isBound
      ? t(`💚 已綁定 (${state.lineProfile.lineDisplayName})`, `💚 Alerts On`, `💚 通知ON`, `💚 알림ON`)
      : t('💬 綁定取餐通知', '💬 Pickup Alerts', '💬 受取通知連携', '💬 픽업 알림');
  }

  const myOrdersBtn = document.getElementById('headerMyOrdersBtn');
  if (myOrdersBtn) {
    const labelSpan = myOrdersBtn.querySelector ? myOrdersBtn.querySelector('span:first-child') : null;
    if (labelSpan) labelSpan.innerText = `🧾 ${t('我的訂單 / 查單', 'My Orders', '注文履歴', '주문내역')}`;
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

  const headerEl = document.querySelector ? document.querySelector('header.app-header') : null;
  if (headerEl) translateRenderedSubtree(headerEl);

  if (document.querySelectorAll) {
    document.querySelectorAll('[data-i18n-zh]').forEach((el) => {
      const zh = el.getAttribute('data-i18n-zh') || '';
      const en = el.getAttribute('data-i18n-en') || zh;
      const ja = el.getAttribute('data-i18n-ja') || en;
      const ko = el.getAttribute('data-i18n-ko') || en;
      el.innerText = t(zh, en, ja, ko);
    });
  }
}

// 顯式子樹翻譯入口（在每次畫面/彈窗渲染後執行，無 MutationObserver）
function applyDomSystemTranslation(rootEl) {
  syncHeaderLanguageControls();
  if (rootEl) {
    translateRenderedSubtree(rootEl);
  } else if (typeof document !== 'undefined' && document.body) {
    translateRenderedSubtree(document.body);
  }
}

function setAppLanguage(nextLang) {
  const allowed = ['zh-TW', 'en', 'ja', 'ko'];
  const cleanLang = allowed.includes(nextLang) ? nextLang : 'zh-TW';
  if (typeof state !== 'undefined' && state) {
    state.lang = cleanLang;
  }
  try { localStorage.setItem('mealflow_lang', cleanLang); } catch (e) {}
  syncHeaderLanguageControls();
  if (typeof applyRouteView === 'function') applyRouteView();
  if (typeof updateCartUI === 'function') updateCartUI();
  if (typeof renderMerchantView === 'function' && typeof state !== 'undefined' && state.routeMode === 'store' && state.isMerchantUnlocked) {
    renderMerchantView();
  }
  if (typeof document !== 'undefined' && document.body) {
    translateRenderedSubtree(document.body);
  }
  const msgMap = {
    'zh-TW': '🌐 已切換為繁體中文介面',
    'en': '🌐 Switched to English interface',
    'ja': '🌐 日本語インターフェースに切り替えました',
    'ko': '🌐 한국어 인터페이스로 변경되었습니다'
  };
  if (typeof showToast === 'function') showToast(msgMap[cleanLang] || msgMap['zh-TW']);
}

function toggleAppLanguage() {
  const order = ['zh-TW', 'en', 'ja', 'ko'];
  const cur = getCurrentAppLang();
  const next = order[(order.indexOf(cur) + 1) % order.length];
  setAppLanguage(next);
}
