import dayjs from 'dayjs';
import { Json } from './types';

export class Log {
  /**
   * 输出日志
   * @param params
   */
  static v(...params: any[]) {
    console.log(dayjs().format('YYYY/MM/DD HH:mm:ss') + ':');
    console.log(...params.map((item) => JSON.stringify(item)));
    console.log('\n');
  }

  /**
   * 错误日志
   * @param params
   */
  static e(...params: any[]) {
    console.error(dayjs().format('YYYY/MM/DD HH:mm:ss') + ':');
    console.error(params);
    console.error('\n');
  }

  /**
   * 结构化日志
   * @param data
   */
  static s(data: Json) {
    console.log(dayjs().format('YYYY/MM/DD HH:mm:ss') + ':');
    for (let key in data) {
      console.log(key + ':', JSON.stringify(data[key]));
    }
    console.log('\n');
  }
}
