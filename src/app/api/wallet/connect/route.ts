export async function POST() {
  return Response.json(
    { error: "server_wallet_connect_disabled", message: "Use the browser wallet connector." },
    { status: 405 }
  );
}
