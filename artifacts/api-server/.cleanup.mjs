import { db, venuesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
const result = await db.delete(venuesTable).where(eq(venuesTable.slug, "test-empty-venue-temp")).returning();
console.log("Deleted:", result.length);
process.exit(0);
