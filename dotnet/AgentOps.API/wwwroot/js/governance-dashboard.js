// Interactive DOM Manipulation & Telemetry Feeds for AgentOps
document.addEventListener("DOMContentLoaded", function () {
    const filterInput = document.getElementById("agentFilterInput");
    if (filterInput) {
        filterInput.addEventListener("input", function (e) {
            const query = e.target.value.toLowerCase();
            const rows = document.querySelectorAll("#agentsTable tbody tr.agent-row");
            rows.forEach(row => {
                const nameCell = row.querySelector(".agent-name");
                if (nameCell) {
                    const text = nameCell.textContent.toLowerCase();
                    row.style.display = text.includes(query) ? "" : "none";
                }
            });
        });
    }

    const inspectButtons = document.querySelectorAll(".btn-inspect-agent");
    inspectButtons.forEach(btn => {
        btn.addEventListener("click", async function () {
            const agentId = btn.getAttribute("data-agent-id");
            btn.textContent = "Loading...";
            try {
                const res = await fetch(`/api/AgentRegistration/${agentId}`);
                if (res.ok) {
                    const data = await res.json();
                    alert(`Agent: ${data.name}\nRole: ${data.role}\nDaily Budget: $${data.dailyBudgetCapUsd}\nActive Permissions: ${data.permissions.length}`);
                }
            } catch (err) {
                console.error(err);
            } finally {
                btn.textContent = "Inspect";
            }
        });
    });
});
