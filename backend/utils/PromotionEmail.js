// Builds the congratulatory email shown in the "Email preview" panel and queued on publish
module.exports = function buildPromotionEmail({ studentName, newBeltName, sessionDate }) {
  const firstName = String(studentName || "").split(" ")[0] || "there";
  const date = sessionDate
    ? new Date(sessionDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })
    : "your recent grading";
  return {
    subject: `Congratulations on your ${newBeltName}!`,
    body:
      `Dear ${firstName},\n\n` +
      `Congratulations on passing your grading on ${date}. ` +
      `Your belt level has been updated to ${newBeltName}.\n\n` +
      `See you on the mat,\nAikido Shinjukai`,
  };
};