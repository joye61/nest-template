type ErrorData = [number, string];

export const Errors: Record<string, ErrorData> = {
  ValidationFailed: [10001, '参数验证失败'],
  CaptchaError: [10002, '验证码错误或已过期'],
};
