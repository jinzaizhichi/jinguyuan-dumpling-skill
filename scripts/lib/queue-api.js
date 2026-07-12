const { failure, success, redact } = require('./result');

const BASE_URL = 'https://m.dianping.com/queue/mdp/ajax/';
const REQUEST_TIMEOUT_MS = 30_000;
const TRACE_HEADERS = ['M-TraceId', 'X-Trace-Id', 'traceid'];

class QueueRequestError extends Error {
  constructor(result) {
    super(result.code);
    this.result = result;
  }
}

function parseCapacity(description) {
  const range = /^(\d+)-(\d+)/.exec(description || '');
  if (range) return { min: Number(range[1]), max: Number(range[2]), description };
  const exact = /^(\d+)/.exec(description || '');
  if (exact) {
    const count = Number(exact[1]);
    return { min: count, max: count, description };
  }
  return { min: null, max: null, description: description || '' };
}

function createQueueApi({
  token,
  fetchImpl = globalThis.fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
}) {
  const headers = {
    'User-Agent': 'MeituanQueue-Skill/2.0',
    Accept: 'application/json',
    enterchannel: '2',
    token
  };

  function safeValue(value) {
    const withoutToken = token ? String(value ?? '').split(token).join('[redacted]') : String(value ?? '');
    return redact(withoutToken);
  }

  function isSensitiveKey(key) {
    return /token|authorization|cookie|password|secret|credential|api[-_]?key|session[-_]?id/i.test(key);
  }

  function deepSanitize(value, key = '') {
    if (key && isSensitiveKey(key)) return '[redacted]';
    if (typeof value === 'string') return safeValue(value);
    if (Array.isArray(value)) return value.map(item => deepSanitize(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [entryKey, deepSanitize(entryValue, entryKey)])
      );
    }
    return value;
  }

  function failureData(response, data = {}) {
    return response && response._traceId
      ? { ...data, traceId: response._traceId }
      : data;
  }

  function traceIdFrom(response) {
    for (const name of TRACE_HEADERS) {
      const value = response.headers && response.headers.get(name);
      if (value) return safeValue(value);
    }
    return null;
  }

  function throwResult(code, message, traceId) {
    throw new QueueRequestError(failure(code, message, traceId ? { traceId } : {}));
  }

  async function request(endpoint, { method = 'GET', params, form } = {}) {
    const url = new URL(endpoint, BASE_URL);
    if (params) url.search = new URLSearchParams(params).toString();
    const requestHeaders = form
      ? { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }
      : headers;
    const controller = new AbortController();
    const timeout = setTimeoutImpl(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: requestHeaders,
        signal: controller.signal,
        ...(form ? { body: new URLSearchParams(form) } : {})
      });
      const traceId = traceIdFrom(response);
      if (response.status === 401 || response.status === 403) {
        throwResult('AUTH_REQUIRED', '登录已过期，请重新授权。', traceId);
      }
      if (!response.ok) {
        throwResult('HTTP_ERROR', `排队服务请求失败（HTTP ${response.status}）。`, traceId);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throwResult('INVALID_RESPONSE', '服务端返回了无法解析的响应。', traceId);
      }
      if (body && [302, 401, 403].includes(body.code)) {
        throwResult('AUTH_REQUIRED', '登录已过期，请重新授权。', traceId);
      }
      if (body && typeof body === 'object' && traceId) body._traceId = traceId;
      return body;
    } catch (error) {
      if (error instanceof QueueRequestError) throw error;
      if (error && error.name === 'AbortError') {
        throw new QueueRequestError(failure('REQUEST_TIMEOUT', '请求超时，请检查网络后重试。'));
      }
      throw new QueueRequestError(failure('NETWORK_ERROR', '网络异常，请稍后重试。'));
    } finally {
      clearTimeoutImpl(timeout);
    }
  }

  async function index(shopId) {
    const response = await request('queueIndexV2', { params: { dpShopId: shopId } });
    if (response.code !== 200) {
      return failure(
        'QUEUE_INDEX_FAILED',
        safeValue(response.errMsg || `请求失败（code=${response.code}）`),
        failureData(response)
      );
    }
    const data = response.data || {};
    const shop = data.queueIndexShopVO || {};
    const tables = (shop.queueTableInfos || []).map(table => ({
      tableTypeId: table.tableTypeId,
      tableTypeName: table.tableTypeName || '未知',
      capacity: parseCapacity(table.tableCapacityDesc),
      waitCount: table.waitCount || 0
    }));
    return success('QUEUE_INDEX', '排队状态查询成功。', {
      shopId,
      shopName: shop.shopName || `门店${shopId}`,
      supportQueue: Boolean(shop.supportQueue),
      supportFirstQueue: Boolean(shop.supportFirstQueue),
      tables,
      orders: data.userQueueOrders || [],
      ...(response._traceId ? { traceId: response._traceId } : {})
    });
  }

  async function takeNumber(shopId, peopleCount, tableTypeId) {
    const indexResponse = await request('queueIndexV2', { params: { dpShopId: shopId } });
    if (indexResponse.code !== 200) {
      return failure(
        'QUEUE_INDEX_FAILED',
        safeValue(indexResponse.errMsg || `请求失败（code=${indexResponse.code}）`),
        failureData(indexResponse)
      );
    }
    const data = indexResponse.data || {};
    const orders = data.userQueueOrders || [];
    if (orders.length > 0) {
      return failure('QUEUE_ORDER_EXISTS', '你已有排队订单，无需重复取号。', { order: orders[0] });
    }

    const shop = data.queueIndexShopVO || {};
    if (!shop.supportQueue) {
      return failure('QUEUE_UNSUPPORTED', '该门店暂不支持在线排队。', { shopId });
    }

    const tableInfos = shop.queueTableInfos || [];
    const selected = tableInfos.find(table => table.tableTypeId === tableTypeId);
    if (!selected) {
      const tables = tableInfos.map(table => ({
        tableTypeId: table.tableTypeId,
        tableTypeName: table.tableTypeName || '未知'
      }));
      return failure('TABLE_NOT_FOUND', `桌型 ${tableTypeId} 不存在。`, { tables });
    }
    if (!shop.supportFirstQueue && (selected.waitCount || 0) === 0) {
      return failure('QUEUE_NOT_NEEDED', `${selected.tableTypeName || '该桌型'}当前无需排队。`, {
        tableTypeId,
        waitCount: selected.waitCount || 0
      });
    }

    const capacity = parseCapacity(selected.tableCapacityDesc);
    if (capacity.min !== null && (peopleCount < capacity.min || peopleCount > capacity.max)) {
      return failure(
        'TABLE_CAPACITY_MISMATCH',
        `就餐人数 ${peopleCount} 与桌型 ${selected.tableTypeName}(${capacity.description})不匹配。`,
        { peopleCount, tableTypeId, capacity }
      );
    }

    const form = {
      dpShopId: shopId,
      peopleCount,
      tableTypeId,
      tableTypeName: selected.tableTypeName || ''
    };
    if (data.phone) form.phone = data.phone;
    const createResponse = await request('queue', { method: 'POST', form });
    const orderId = createResponse.data && createResponse.data.queueOrderViewId;
    if (createResponse.code !== 200 || !orderId) {
      return failure(
        'QUEUE_CREATE_FAILED',
        safeValue(createResponse.errMsg || '取号失败。'),
        failureData(createResponse)
      );
    }

    let detail = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await sleep(1000);
      try {
        const detailResponse = await request('queueOrderDetail', {
          params: { queueOrderViewId: orderId }
        });
        if (detailResponse.code === 200 && detailResponse.data) {
          detail = detailResponse.data;
          if (detail.queueOrderStatus !== 1) break;
        }
      } catch {
        break;
      }
    }

    return success('QUEUE_NUMBER_TAKEN', '取号成功。', {
      orderId,
      tableTypeId,
      tableTypeName: selected.tableTypeName || '',
      peopleCount,
      order: detail,
      ...(createResponse._traceId ? { traceId: createResponse._traceId } : {})
    });
  }

  async function latestOrder(shopId) {
    const response = await request('queueIndexV2', { params: { dpShopId: shopId } });
    if (response.code !== 200) {
      return {
        error: failure(
          'QUEUE_INDEX_FAILED',
          safeValue(response.errMsg || `请求失败（code=${response.code}）`),
          failureData(response)
        )
      };
    }
    const order = (response.data && response.data.userQueueOrders || [])[0];
    if (!order || !order.queueOrderViewId) {
      return { error: failure('QUEUE_ORDER_NOT_FOUND', '当前无排队订单。', failureData(response)) };
    }
    return { order };
  }

  async function orderDetail(shopId) {
    const latest = await latestOrder(shopId);
    if (latest.error) return latest.error;
    const response = await request('queueOrderDetail', {
      params: { queueOrderViewId: latest.order.queueOrderViewId }
    });
    if (response.code !== 200 || !response.data) {
      return failure(
        'QUEUE_ORDER_DETAIL_FAILED',
        safeValue(response.errMsg || '查询订单详情失败。'),
        failureData(response)
      );
    }
    return success('QUEUE_ORDER_DETAIL', '排队订单详情查询成功。', {
      order: response.data,
      ...(response._traceId ? { traceId: response._traceId } : {})
    });
  }

  async function orderCancel(shopId) {
    const latest = await latestOrder(shopId);
    if (latest.error) return latest.error;
    const orderId = latest.order.queueOrderViewId;
    const response = await request('cancelQueue', {
      method: 'POST',
      form: { queueOrderViewId: orderId }
    });
    if (response.code !== 200) {
      return failure(
        'QUEUE_CANCEL_FAILED',
        safeValue(response.errMsg || '取消排队失败。'),
        failureData(response, { orderId })
      );
    }
    return success('QUEUE_CANCELLED', '排队已取消。', {
      orderId,
      order: response.data || null,
      ...(response._traceId ? { traceId: response._traceId } : {})
    });
  }

  function stable(operation) {
    return async (...args) => {
      try {
        return deepSanitize(await operation(...args));
      } catch (error) {
        if (error instanceof QueueRequestError) return deepSanitize(error.result);
        return deepSanitize(failure('QUEUE_API_ERROR', '排队操作失败，请稍后重试。'));
      }
    };
  }

  return {
    index: stable(index),
    takeNumber: stable(takeNumber),
    orderDetail: stable(orderDetail),
    orderCancel: stable(orderCancel)
  };
}

module.exports = { createQueueApi };
