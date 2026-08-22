import { redirect } from "next/navigation";

import { DEFAULT_CATEGORY } from "@/lib/categories";

/**
 * /chart is kept as a stable entry point but redirects to the category's own
 * URL, so every category has exactly one canonical address and the flagship
 * does not exist at two.
 */
export default function ChartIndex() {
  redirect(`/chart/${DEFAULT_CATEGORY}`);
}
