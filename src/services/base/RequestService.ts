import { Injectable } from '@nestjs/common';
import axios, { AxiosRequestConfig } from 'axios';
import { isPlainObject } from 'lodash';
import { Json } from 'src/common/types';

export type RequestOption = {
  timeout?: number;
} & RequestInit;

@Injectable()
export class RequestService {
  private readonly DEFAULT_TIMEOUT = 30000; // 30 秒

  /**
   * 发起GET请求，拉取数据
   * @param url
   * @param data
   * @param option
   * @returns
   */
  async get<T = any>(
    url: string,
    data?: Json,
    option?: Omit<AxiosRequestConfig, 'url' | 'params'>,
  ): Promise<T> {
    const config: AxiosRequestConfig = {
      ...(option || {}),
      method: 'GET',
      responseType: 'json',
      timeout: option?.timeout || this.DEFAULT_TIMEOUT,
      headers: {
        ...option?.headers,
      },
    };
    if (isPlainObject(data)) {
      config.params = data;
    }
    const response = await axios(url, config);
    return response.data as T;
  }

  /**
   * 发起POST请求，提交数据
   * @param url
   * @param data
   * @param option
   * @returns
   */
  async post<T = any, D = any>(
    url: string,
    data?: D,
    option?: Omit<AxiosRequestConfig, 'url' | 'data'>,
  ): Promise<T> {
    const config: AxiosRequestConfig = {
      ...(option || {}),
      method: 'POST',
      responseType: 'json',
      timeout: option?.timeout || this.DEFAULT_TIMEOUT,
      headers: {
        ...option?.headers,
      },
    };
    if (!data) {
      const response = await axios(url, config);
      return response.data as T;
    }

    if (isPlainObject(data)) {
      const searchParams = new URLSearchParams();
      Object.entries(data).forEach(([key, value]) => {
        searchParams.append(key, String(value));
      });
      config.data = searchParams;
    } else {
      config.data = data;
    }

    const response = await axios(url, config);
    return response.data as T;
  }

  /**
   * 发起JSON请求
   * @param url
   * @param data
   * @param option
   * @returns
   */
  async json<T = any>(
    url: string,
    data?: Record<string, any>,
    option?: Omit<AxiosRequestConfig, 'url' | 'data'>,
  ): Promise<T> {
    const config: AxiosRequestConfig = {
      ...(option || {}),
      method: 'POST',
      responseType: 'json',
      timeout: option?.timeout || this.DEFAULT_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        ...option?.headers,
      },
    };
    if (!data || !isPlainObject(data)) {
      const response = await axios(url, config);
      return response.data as T;
    }

    config.data = JSON.stringify(data);
    const response = await axios(url, config);
    return response.data as T;
  }
}
