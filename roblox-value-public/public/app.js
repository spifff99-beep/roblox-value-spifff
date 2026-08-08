const form = document.getElementById("checkForm");
const input = document.getElementById("username");
const button = document.getElementById("checkButton");
const message = document.getElementById("message");
const result = document.getElementById("result");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const value = input.value.trim();
  if (!value) return;

  button.disabled = true;
  button.textContent = "Checking...";
  message.textContent = "";
  result.classList.add("hidden");

  const looksLikeId = /^\d+$/.test(value);

  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        looksLikeId ? { userId: value } : { username: value }
      )
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || "Could not check this account.");

    showResult(data);
  } catch (error) {
    message.textContent = error.message;
    message.className = "message error";
  } finally {
    button.disabled = false;
    button.textContent = "Check Value";
  }
});

function showResult(user) {
  const avatar =
    `https://www.roblox.com/headshot-thumbnail/image?userId=${encodeURIComponent(user.userId)}&width=420&height=420&format=png`;

  result.innerHTML = `
    <div class="profile">
      <img src="${avatar}" alt="">
      <div>
        <div class="eyebrow">RESULT</div>
        <h2>${escapeHtml(user.username)}</h2>
        <p>User ID ${escapeHtml(user.userId)}</p>
      </div>
    </div>

    <div class="big-value">
      <span>Inventory Value</span>
      <strong>${Number(user.value || 0).toLocaleString()} R$</strong>
      <small>${Number(user.pricedItemCount || 0).toLocaleString()} priced items / ${Number(user.itemCount || 0).toLocaleString()} inventory items</small>
    </div>

    <div class="result-footer">
      <span>Saved to the public leaderboard</span>
      <a href="/leaderboard.html">View All Users →</a>
    </div>
  `;

  result.classList.remove("hidden");
  message.textContent = user.cached
    ? "Showing a recently cached result."
    : "Value calculated and saved.";
  message.className = "message success";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}