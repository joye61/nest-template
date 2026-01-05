import { ValidationPipe, HttpException, HttpStatus } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { Errors } from 'src/errors';

export const globalValidation = new ValidationPipe({
  // 验证选项
  whitelist: true, // 自动移除未在 DTO 中定义的属性
  forbidNonWhitelisted: false, // 不抛出错误（与自定义实现保持一致）
  stopAtFirstError: true, // 遇到第一个错误就停止验证
  transform: true, // 自动转换类型（plainToInstance）
  transformOptions: {
    enableImplicitConversion: true, // 启用隐式类型转换
  },

  // 自定义错误响应格式
  exceptionFactory(errors) {
    // 获取第一个错误
    const firstError = errors[0];

    // 递归获取第一个约束消息
    const getFirstConstraint = (error: ValidationError): string => {
      if (error.constraints) {
        const constraintKeys = Object.keys(error.constraints);
        if (constraintKeys.length > 0) {
          return error.constraints[constraintKeys[0]];
        }
      }
      if (error.children && error.children.length > 0) {
        return getFirstConstraint(error.children[0]);
      }
      return Errors.ValidationFailed[1];
    };

    const errorMessage = getFirstConstraint(firstError);

    // 返回 HttpException，状态码为 200（业务异常）
    // GlobalExceptionFilter 会捕获并处理这个异常
    throw new HttpException(
      {
        code: Errors.ValidationFailed[0],
        message: errorMessage,
        data: null,
      },
      HttpStatus.OK,
    );
  },
});
