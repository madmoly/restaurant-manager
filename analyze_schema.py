import re

# Read schema.ts
with open(r'C:\Users\madmo\Documents\Claude\Projects\restaurant-manager\drizzle\schema.ts', 'r', encoding='utf-8') as f:
    schema_content = f.read()

# Read index.ts
with open(r'C:\Users\madmo\Documents\Claude\Projects\restaurant-manager\server\index.ts', 'r', encoding='utf-8') as f:
    migration_content = f.read()

# Extract all table definitions from schema.ts (export const tableName = mysqlTable(...))
schema_tables = {}
for match in re.finditer(r'export const (\w+)\s*=\s*mysqlTable\([\'"](\w+)', schema_content):
    var_name, db_name = match.groups()
    schema_tables[db_name] = var_name
    print(f"[SCHEMA] {var_name} -> {db_name}")

print(f"\nTotal tables in schema.ts: {len(schema_tables)}\n")

# Extract CREATE TABLE statements from migration
create_tables = re.findall(r"CREATE TABLE IF NOT EXISTS ['\"`]?(\w+)", migration_content)
print("=== CREATE TABLE statements in migration ===")
for table_name in create_tables:
    print(f"  {table_name}")

print(f"\nTotal: {len(create_tables)}\n")

# Check for missing CREATE TABLE
print("=== MISSING in migration (defined in schema but no CREATE TABLE) ===")
missing = set(schema_tables.keys()) - set(create_tables)
if missing:
    for table in sorted(missing):
        print(f"  {table} ({schema_tables[table]})")
else:
    print("  [NONE - All schema tables have CREATE TABLE]")

# Check for extra CREATE TABLE
print("\n=== EXTRA in migration (CREATE TABLE but not in schema) ===")
extra = set(create_tables) - set(schema_tables.keys())
if extra:
    for table in sorted(extra):
        print(f"  {table}")
else:
    print("  [NONE - All CREATE TABLE statements match schema]")

# Extract columns from schema.ts
print("\n=== COLUMN DEFINITIONS (sample from schema.ts) ===")
columns_in_schema = re.findall(r'(\w+):\s*varchar\(|(\w+):\s*int|(\w+):\s*text|(\w+):\s*boolean|(\w+):\s*timestamp|(\w+):\s*date|(\w+):\s*decimal', schema_content)
column_count = sum(1 for col_tuple in columns_in_schema for col in col_tuple if col)
print(f"Approximate column count: {column_count}")

print("\n=== ALTER TABLE statements in migration ===")
alter_tables = re.findall(r"ALTER TABLE ['\"`]?(\w+)['\"`]?\s+ADD COLUMN", migration_content)
print(f"Found {len(alter_tables)} ALTER TABLE ADD COLUMN statements")
for table in sorted(set(alter_tables)):
    count = alter_tables.count(table)
    print(f"  {table}: {count} columns added")
