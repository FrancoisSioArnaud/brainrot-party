export type WSMsg = {
  type: string;
  req_id?: string;
  ts?: number;
  payload?: any;
};

export function ack(req_id: string | undefined, payload: any = {}) {
  return { type: "ack", req_id, ts: Date.now(), payload };
}

export function err(req_id: string | undefined, code: string, message: string, extra?: any) {
  return { type: "error", req_id, ts: Date.now(), payload: { code, message, ...extra } };
}
