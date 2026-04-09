import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../drizzle/schema";

const pool = mysql.createPool(process.env.DATABASE_URL!);

export const db = drizzle(pool, { schema, mode: "default" });
// raw 풀 export — seedChecklists 등 Drizzle 외부 쿼리에서 재사용 (createConnection 중복 생성 방지)
export const rawPool = pool;
