export default async function handler(request, context) {
  return context.next();
}

export const config = { path: "/anthropic-proxy" };