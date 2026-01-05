import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { STATUS_CODES } from 'http';
import { ApiResult } from './common/types';
import { Log } from 'src/common/Log';
import { Utils } from 'src/common/Utils';
import dayjs from 'dayjs';

/**
 * 全局异常过滤器
 *
 * 异常类型处理：
 * - HttpException (status=200)：业务异常，返回 JSON 格式
 * - HttpException (status≠200)：HTTP 错误，返回 text/html 格式
 * - 其他异常：系统异常，返回 HTTP 500 + text/html 格式
 *
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      this.handleHttpException(exception, request, response);
    } else {
      this.handleSystemException(exception, request, response);
    }
  }

  /**
   * 处理 HttpException 异常
   */
  private handleHttpException(
    exception: HttpException,
    request: Request,
    response: Response,
  ): void {
    const data = exception.getResponse();
    const status = exception.getStatus();

    // HTTP 200（业务异常）→ 返回 JSON 格式
    if (status === HttpStatus.OK) {
      const jsonData = this.isApiResult(data) ? data : Utils.json(data);
      response.status(HttpStatus.OK).json(jsonData);
      return;
    }

    // HTTP 错误（status ≠ 200）→ 记录日志并返回 text/html
    Log.e('[HTTP Exception]', request.method, request.url, exception);
    const message = STATUS_CODES[status] || 'Unknown Error';
    response.status(status).type('text/html').send(message);
  }

  /**
   * 处理系统异常（未捕获的错误）
   */
  private handleSystemException(
    exception: unknown,
    request: Request,
    response: Response,
  ): void {
    console.error(dayjs().format('YYYY/MM/DD HH:mm:ss') + ':');
    console.error(exception)
    const status = HttpStatus.INTERNAL_SERVER_ERROR;
    response
      .status(status)
      .type('text/html')
      .send(STATUS_CODES[status] || 'Unknown Error');
  }

  /**
   * 判断对象是否为标准 ApiResult 格式
   */
  private isApiResult(obj: unknown): obj is ApiResult {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }

    const output = obj as any;
    return (
      typeof output.code === 'number' &&
      typeof output.message === 'string' &&
      'data' in output
    );
  }
}
