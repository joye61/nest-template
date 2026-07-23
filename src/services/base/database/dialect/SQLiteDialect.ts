import { SQLHolderValue, UpsertParams, ValueHolders } from './BaseDialect';
import { QuestionMarkDialect } from './MySQLDialect';
import { FieldValue, OrderBy, UpdateFieldValue, Where } from '../type';

/**
 * SQLite 方言实现
 *
 * SQLite 与 MySQL 都支持反引号标识符和问号占位符，因此复用通用查询构建逻辑，
 * 仅覆盖分页与 UPSERT 等存在语法差异的部分。
 *
 * 当前主要处理三类差异：
 * - 文本正则筛选使用 REGEXP，而不是 MySQL 的 RLIKE
 * - 分页语法固定为 LIMIT count OFFSET offset
 * - UPDATE / DELETE 限制条数时，借助 rowid 子查询保持统一 API
 */
export class SQLiteDialect extends QuestionMarkDialect {
  readonly type = 'sqlite' as const;

  /**
   * SQLite 使用 REGEXP 关键字，函数实现由 SQLiteDriver 注册
   */
  createFilter(key: string, value: FieldValue): ValueHolders {
    const result = super.createFilter(key, value);
    return {
      ...result,
      prepare: result.prepare
        .replace(/\sNOT RLIKE\s/g, ' NOT REGEXP ')
        .replace(/\sRLIKE\s/g, ' REGEXP '),
    };
  }

  /**
   * SQLite 使用 LIMIT count OFFSET offset 语法
   */
  protected buildLimitOffset(limit: number, offset: number): string {
    if (offset > 0) {
      return ` LIMIT ${limit} OFFSET ${offset}`;
    }
    return ` LIMIT ${limit}`;
  }

  /**
   * SQLite 默认未启用 UPDATE ORDER BY LIMIT，使用 rowid 子查询保持公共 API
    * 这样业务层仍可继续传入 order 和 limit，无需区分数据库类型。
   */
  buildUpdate(params: {
    table: string;
    data: Record<string, any>;
    where?: Where;
    order?: OrderBy;
    limit?: number;
  }): ValueHolders {
    if (!params.limit || params.limit <= 0) {
      return super.buildUpdate({ ...params, order: undefined });
    }

    const dataHolders: SQLHolderValue[] = [];
    const updateParts: string[] = [];
    for (const key in params.data) {
      const result = this.createDataFilter(
        key,
        params.data[key] as UpdateFieldValue,
      );
      if (result.prepare) {
        updateParts.push(result.prepare);
        dataHolders.push(...result.holders);
      }
    }
    if (updateParts.length === 0) {
      throw new Error('No fields to update');
    }

    const target = this.buildRowIdTarget(params);
    return {
      prepare: `UPDATE ${this.escapeIdentifier(params.table)} SET ${updateParts.join(', ')} WHERE rowid IN (${target.prepare})`,
      holders: [...dataHolders, ...target.holders],
    };
  }

  /**
   * SQLite 默认未启用 DELETE ORDER BY LIMIT，使用 rowid 子查询保持公共 API
    * 通过先选出目标 rowid，再执行删除，兼容常见 SQLite 编译选项。
   */
  buildDelete(params: {
    table: string;
    where?: Where;
    order?: OrderBy;
    limit?: number;
  }): ValueHolders {
    if (!params.limit || params.limit <= 0) {
      return super.buildDelete({ ...params, order: undefined });
    }

    const target = this.buildRowIdTarget(params);
    return {
      prepare: `DELETE FROM ${this.escapeIdentifier(params.table)} WHERE rowid IN (${target.prepare})`,
      holders: target.holders,
    };
  }

  /**
   * 构建 SQLite UPSERT (INSERT ... ON CONFLICT ... DO UPDATE)
    * 若没有可更新字段，则退化为 DO NOTHING。
   */
  buildUpsert(params: UpsertParams): ValueHolders {
    const { table, data, uniqueKeys, updateData } = params;
    const fields = Object.keys(data);
    const holders: SQLHolderValue[] = fields.map((key) =>
      this.toSQLHolder(data[key]),
    );
    const escapedFields = fields.map((key) => this.escapeIdentifier(key));
    const placeholders = fields.map(() => this.getPlaceholder()).join(', ');
    const conflictFields = uniqueKeys
      .map((key) => this.escapeIdentifier(key))
      .join(', ');

    let sql = `INSERT INTO ${this.escapeIdentifier(table)} (${escapedFields.join(', ')}) VALUES (${placeholders})`;
    const updateFields = updateData || data;
    const updateParts: string[] = [];

    for (const key in updateFields) {
      if (uniqueKeys.includes(key)) {
        continue;
      }
      const result = this.createDataFilter(key, updateFields[key]);
      if (result.prepare) {
        updateParts.push(result.prepare);
        holders.push(...result.holders);
      }
    }

    sql += ` ON CONFLICT (${conflictFields})`;
    if (updateParts.length === 0) {
      sql += ' DO NOTHING';
    } else {
      sql += ` DO UPDATE SET ${updateParts.join(', ')}`;
    }

    return { prepare: sql, holders };
  }

  /**
   * 构建受 limit/order 约束的 rowid 子查询，供 UPDATE/DELETE 复用。
   */
  private buildRowIdTarget(params: {
    table: string;
    where?: Where;
    order?: OrderBy;
    limit?: number;
  }): ValueHolders {
    let prepare = `SELECT rowid FROM ${this.escapeIdentifier(params.table)}`;
    const whereResult = this.createWhere(params.where);
    if (whereResult.prepare) {
      prepare += ` WHERE ${whereResult.prepare}`;
    }
    const order = this.createOrder(params.order);
    if (order) {
      prepare += ` ORDER BY ${order}`;
    }
    prepare += ` LIMIT ${params.limit}`;
    return { prepare, holders: whereResult.holders };
  }
}
