/**
 * 测试环境的绑定类型。
 *
 * `cloudflare:test` 的 `env` 声明为 `Cloudflare.Env`，因此这里扩充该命名空间，
 * 让每个测试文件都能获得正确的绑定类型（而不是 any）。
 */

import type { D1Migration } from 'cloudflare:test';

declare global {
    namespace Cloudflare {
        interface Env {
            /** D1 绑定 */
            DB: D1Database;
            /** 静态资源绑定（测试中一般不使用） */
            ASSETS: Fetcher;
            /** 口令挑战用的服务端密钥 */
            SERVER_KDF_SECRET: string;
            ENVIRONMENT: string;
            /** 由 vitest.config.ts 注入的 schema 迁移 */
            TEST_MIGRATIONS: D1Migration[];
        }
    }
}

export {};
