import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

/**
 * 测试在**真实 workerd** 中运行（不是 jsdom/mock），D1 使用隔离的本地实例。
 *
 * 只应用 0001_schema.sql —— 0002_seed.sql 是生产数据（1569 道真题），
 * 让测试依赖它既慢又把用例与线上数据耦合。每个用例自行准备所需的
 * 最小夹具，反而更清晰、更稳定。
 */
export default defineConfig(async () => {
    const allMigrations = await readD1Migrations('./worker/migrations');
    const schemaMigrations = allMigrations.filter((m) => m.name.startsWith('0001'));

    return {
        plugins: [
            cloudflareTest({
                wrangler: { configPath: './wrangler.jsonc' },
                miniflare: {
                    bindings: {
                        TEST_MIGRATIONS: schemaMigrations,
                        // 测试用的固定 KDF 密钥，避免依赖 secret 配置
                        SERVER_KDF_SECRET: 'test-kdf-secret-with-enough-length',
                        ENVIRONMENT: 'test',
                    },
                },
            }),
        ],
        test: {
            setupFiles: ['./worker/test/setup.ts'],
            include: ['worker/test/**/*.spec.ts'],
        },
    };
});
