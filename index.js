/**
 * MealFlow Cloudflare Workers + D1 — 完整版路由入口 (48/48 Action 100% 對齊原 code.gs) + CORS + Cron 排程
 */

import { BRAND_NAME, DB_SCHEMA_VERSION } from './utils.js';
import {
  assertManagerAuthorized,
  handleLogoutMerchantSession,
  handleUpdateMerchantPin,
  handleUpdateStaffSecurityConfig,
  handleVerifyManagerOverride,
  handleVerifyMerchantPin
} from './auth.js';
import {
  getNextPickupNumber,
  handleAckPrintJob,
  handleAddMerchantOrderNote,
  handleAppendOrderItems,
  handleCancelOrder,
  handleChangeOrderPaymentMethod,
  handleGetOrder,
  handleGetPendingPrintJobs,
  handleGetPickupBoard,
  handleInitBundle,
  handleLookupOrders,
  handleMarkReservationPaid,
  handleModifyOrderItems,
  handleRequeuePrintJob,
  handleRestoreSoldOutMenusBatch,
  handleSubmitOrder,
  handleToggleMenuSoldOut,
  handleUpdateOrderItemCheckState,
  handleUpdateOrderStatus,
  handleUpdateStoreConfig,
  runScheduledReservationPromotion
} from './orders.js';
import {
  handleBatchApplyMenuOptions,
  handleCreateStore,
  handleDeleteSingleMenuItem,
  handleDeleteStore,
  handleSaveStoreMenus,
  handleSaveStoreProfile,
  handleSimulateTraffic,
  handleUpdateStoresVisibility,
  handleUpsertSingleMenuItem
} from './catalog.js';
import {
  handleGetShiftZReport,
  handleGetStoreAnalytics,
  handleLockShiftZReport,
  handleOpenShiftRecord,
  handleSaveMerchantAuditLog,
  handleSaveShiftPettyCash,
  handleUnlockShiftZReport
} from './reports.js';
import {
  handleAiConcierge,
  handleAiParseMenu,
  handleConfirmLinePayCheckout,
  handleGetMemberProfile,
  handleLineCallback,
  handleManualLinePush,
  handlePosLinePayOneTimeKeyCharge,
  handleRequestLinePayCheckout,
  handleSaveLineDevConfig,
  handleSaveMemberProfile
} from './integrations.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS
    }
  });
}

async function dispatchPostAction(env, ctx, action, params) {
  switch (action) {
    // ===== 1. 公開查詢、下單與看板 =====
    case 'initBundle':
      return handleInitBundle(env, params, ctx);
    case 'getPickupBoard':
      return handleGetPickupBoard(env, params, ctx);
    case 'getOrder':
      return handleGetOrder(env, params, ctx);
    case 'lookupOrders':
      return handleLookupOrders(env, params);
    case 'submitOrder':
      return handleSubmitOrder(env, ctx, params);

    // ===== 2. 店務授權與一人一碼 PIN 管理 =====
    case 'verifyMerchantPin':
      return handleVerifyMerchantPin(env, params);
    case 'verifyManagerOverride':
      return handleVerifyManagerOverride(env, params);
    case 'logoutMerchantSession':
      return handleLogoutMerchantSession(env, params);
    case 'updateMerchantPin':
    case 'updateMerchantPinHash':
      await assertManagerAuthorized(env, params, params.storeId || '');
      return handleUpdateMerchantPin(env, params);
    case 'updateStaffSecurityConfig':
      await assertManagerAuthorized(env, params, params.storeId || '');
      return handleUpdateStaffSecurityConfig(env, params);

    // ===== 3. KDS 控單、改單、併單、取消與付款修正 =====
    case 'updateOrderStatus':
      return handleUpdateOrderStatus(env, ctx, params);
    case 'markReservationPaid':
      return handleMarkReservationPaid(env, ctx, params);
    case 'cancelOrder':
      return handleCancelOrder(env, ctx, params);
    case 'updateOrderItemCheckState':
      return handleUpdateOrderItemCheckState(env, ctx, params);
    case 'modifyOrderItems':
      return handleModifyOrderItems(env, ctx, params);
    case 'appendOrderItems':
      return handleAppendOrderItems(env, ctx, params);
    case 'addMerchantOrderNote':
      return handleAddMerchantOrderNote(env, ctx, params);
    case 'changeOrderPaymentMethod':
      return handleChangeOrderPaymentMethod(env, ctx, params);

    // ===== 4. 三星 / Windows 熱感出單機佇列 =====
    case 'getPendingPrintJobs':
      return handleGetPendingPrintJobs(env, params);
    case 'ackPrintJob':
      return handleAckPrintJob(env, ctx, params);
    case 'requeuePrintJob':
      return handleRequeuePrintJob(env, ctx, params);

    // ===== 5. 店鋪、菜單與營業設定完整 CRUD =====
    case 'updateStoreConfig':
      return handleUpdateStoreConfig(env, params);
    case 'updateStoresVisibility':
      return handleUpdateStoresVisibility(env, params);
    case 'saveStoreProfile':
      return handleSaveStoreProfile(env, params);
    case 'createStore':
      return handleCreateStore(env, params);
    case 'deleteStore':
      return handleDeleteStore(env, params);
    case 'saveStoreMenus':
    case 'saveStoreMenu':
      return handleSaveStoreMenus(env, params);
    case 'upsertSingleMenuItem':
      return handleUpsertSingleMenuItem(env, params);
    case 'batchApplyMenuOptions':
      return handleBatchApplyMenuOptions(env, params);
    case 'deleteSingleMenuItem':
      return handleDeleteSingleMenuItem(env, params);
    case 'toggleMenuSoldOut':
      return handleToggleMenuSoldOut(env, params);
    case 'restoreSoldOutMenusBatch':
      return handleRestoreSoldOutMenusBatch(env, params);
    case 'simulateTraffic':
      return handleSimulateTraffic(env, params);

    // ===== 6. SQL 版交班日結 (Z-Report)、全區間營運分析與稽核 =====
    case 'openShiftRecord':
      return handleOpenShiftRecord(env, params);
    case 'getShiftZReport':
      return handleGetShiftZReport(env, params);
    case 'getStoreAnalytics':
      return handleGetStoreAnalytics(env, params);
    case 'lockShiftZReport':
      return handleLockShiftZReport(env, params);
    case 'unlockShiftZReport':
      return handleUnlockShiftZReport(env, params);
    case 'saveShiftPettyCash':
      return handleSaveShiftPettyCash(env, params);
    case 'saveMerchantAuditLog':
      return handleSaveMerchantAuditLog(env, params);

    // ===== 7. LINE Pay V3、LINE Login / Push、Gemini AI 與會員 =====
    case 'requestLinePayCheckout':
      return handleRequestLinePayCheckout(env, params);
    case 'confirmLinePayCheckout':
      return handleConfirmLinePayCheckout(env, ctx, params, getNextPickupNumber);
    case 'posLinePayCharge':
      return handlePosLinePayOneTimeKeyCharge(env, params);
    case 'handleLineCallback':
      return handleLineCallback(env, params);
    case 'saveLineDevConfig':
      return handleSaveLineDevConfig(env, params);
    case 'sendLinePush':
      return handleManualLinePush(env, params);
    case 'askAiConcierge':
      return handleAiConcierge(env, params, handleInitBundle);
    case 'aiParseMenu':
      return handleAiParseMenu(env, params);
    case 'getMemberProfile':
      return handleGetMemberProfile(env, params);
    case 'saveMemberProfile':
      return handleSaveMemberProfile(env, params);

    // ===== 8. 排程手動觸發（供管理員檢修預訂單自動推進） =====
    case 'runScheduledMaintenance':
      await assertManagerAuthorized(env, params, '');
      return runScheduledReservationPromotion(env, ctx);

    default:
      throw new Error('未知的操作請求: ' + action);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      const url = new URL(request.url);

      if (request.method === 'GET') {
        const sp = url.searchParams;
        const action = String(sp.get('action') || '').trim();

        if (action === 'getOrder' && sp.get('orderId')) {
          const res = await handleGetOrder(env, {
            orderId: sp.get('orderId'),
            v: sp.get('v') || sp.get('verificationCode') || '',
            clientDeviceId: sp.get('clientDeviceId') || '',
            merchantAuthToken: sp.get('merchantAuthToken') || ''
          }, ctx);
          return jsonResponse({ success: true, ...res });
        }

        if (action === 'getPickupBoard') {
          const res = await handleGetPickupBoard(env, {
            storeId: sp.get('storeId') || sp.get('store') || '',
            forceRefresh: sp.get('forceRefresh') === '1' || sp.get('forceRefresh') === 'true'
          }, ctx);
          return jsonResponse({ success: true, ...res });
        }

        if (action === 'getPendingPrintJobs') {
          const res = await handleGetPendingPrintJobs(env, {
            storeId: sp.get('storeId') || sp.get('store') || '',
            printerKey: sp.get('printerKey') || sp.get('key') || '',
            merchantAuthToken: sp.get('merchantAuthToken') || ''
          });
          return jsonResponse({ success: true, ...res });
        }

        if (action === 'initBundle') {
          const myOrderIdsRaw = sp.get('myOrderIds') || '';
          const res = await handleInitBundle(env, {
            campus: sp.get('campus') || '',
            myOrderIds: myOrderIdsRaw ? myOrderIdsRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
            clientDeviceId: sp.get('clientDeviceId') || '',
            lineUserId: sp.get('lineUserId') || '',
            merchantAuthToken: sp.get('merchantAuthToken') || '',
            storeId: sp.get('storeId') || '',
            forceRefresh: sp.get('forceRefresh') === '1' || sp.get('forceRefresh') === 'true'
          }, ctx);
          return jsonResponse({ success: true, ...res });
        }

        return jsonResponse({
          success: true,
          service: `${BRAND_NAME} Cloudflare Workers + D1 完整權威引擎`,
          version: DB_SCHEMA_VERSION,
          status: 'ONLINE',
          parity: 'FULL_48_ACTIONS',
          firestoreEnabled: Boolean(env.FB_PROJECT_ID && env.FB_CLIENT_EMAIL && env.FB_PRIVATE_KEY)
        });
      }

      if (request.method === 'POST') {
        const rawBody = await request.text();
        let params = {};
        if (rawBody && rawBody.trim()) {
          try {
            params = JSON.parse(rawBody);
          } catch {
            return jsonResponse({ success: false, message: '無效的 JSON 請求內容' }, 400);
          }
        }
        const action = String(params.action || '').trim();
        if (!action) {
          return jsonResponse({ success: false, message: '缺少必要參數 action' }, 400);
        }

        const result = await dispatchPostAction(env, ctx, action, params);
        // handleLineCallback 可能直接回傳 { success: false, message }
        if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'success')) {
          return jsonResponse(result);
        }
        return jsonResponse({ success: true, ...result });
      }

      return jsonResponse({ success: false, message: `不支援的 HTTP 方法: ${request.method}` }, 405);
    } catch (err) {
      return jsonResponse({
        success: false,
        message: err && err.message ? err.message : String(err)
      });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runScheduledReservationPromotion(env, ctx)
        .then(res => console.log('[Cron] scheduled promotion:', JSON.stringify(res)))
        .catch(err => console.error('[Cron] error:', err))
    );
  }
};
