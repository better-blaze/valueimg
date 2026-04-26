(function () {
  const pinEl = document.getElementById("pinDisplay");
  const userCountEl = document.getElementById("userCount");
  const lobbyPanel = document.getElementById("lobbyPanel");
  const evalPanel = document.getElementById("evalPanel");
  const adminEvalImage = document.getElementById("adminEvalImage");
  const adminSubmitStatus = document.getElementById("adminSubmitStatus");
  const targetClassInput = document.getElementById("targetClassInput");
  const totalImagesInput = document.getElementById("totalImagesInput");
  const startEvalBtn = document.getElementById("startEvalBtn");
  const forceNextImageBtn = document.getElementById("forceNextImageBtn");
  const pageSubtitle = document.getElementById("pageSubtitle");

  /** 평가 시작 시점에 확정된 전체 참가자 수 (b) */
  let totalParticipantsB = 0;

  let votesUnsubscribe = null;
  let lastWatchedIndex = null;
  let prevSessionStatus = null;
  let autoAdvanceTimer = null;
  let advanceInFlight = false;

  function generateFourDigitPin() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  function showLobbyUI() {
    evalPanel.hidden = true;
    evalPanel.classList.add("panel--hidden");
    lobbyPanel.hidden = false;
    lobbyPanel.classList.remove("panel--hidden");
  }

  function showEvalUI() {
    lobbyPanel.hidden = true;
    lobbyPanel.classList.add("panel--hidden");
    evalPanel.hidden = false;
    evalPanel.classList.remove("panel--hidden");
  }

  function setEvalSubtitle() {
    pageSubtitle.textContent =
      "학생 화면이 평가 모드로 전환되었습니다. 제출 현황을 확인하세요.";
  }

  function setLobbySubtitle() {
    pageSubtitle.textContent = "학생들에게 아래 PIN을 알려 주세요.";
  }

  function setFinishedSubtitle() {
    pageSubtitle.textContent =
      "이번 반 평가가 종료되었습니다. 새 반을 준비한 뒤 다시 평가를 시작할 수 있습니다.";
  }

  function stopVotesWatch() {
    if (typeof votesUnsubscribe === "function") {
      votesUnsubscribe();
      votesUnsubscribe = null;
    }
    lastWatchedIndex = null;
  }

  function requestAdvanceOrFinish() {
    if (advanceInFlight) {
      return Promise.resolve();
    }
    advanceInFlight = true;
    return sessionRef
      .once("value")
      .then(function (snap) {
        const s = snap.val() || {};
        if (s.status !== "evaluating") {
          return;
        }
        const cur = Number(s.currentIndex) || 1;
        const totalImg = Number(s.totalImages) || 0;
        if (totalImg < 1) {
          return;
        }
        const next = cur + 1;
        if (next > totalImg) {
          return sessionRef.update({ status: "finished" });
        }
        return sessionRef.update({ currentIndex: next });
      })
      .finally(function () {
        advanceInFlight = false;
      });
  }

  function scheduleAutoAdvanceIfComplete(a) {
    if (totalParticipantsB <= 0 || a !== totalParticipantsB) {
      return;
    }
    if (autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer);
    }
    autoAdvanceTimer = setTimeout(function () {
      autoAdvanceTimer = null;
      sessionRef.once("value").then(function (snap) {
        const s = snap.val() || {};
        if (s.status !== "evaluating") {
          return;
        }
        const idx = Number(s.currentIndex) || 1;
        return db
          .ref("currentSession/votes/" + idx)
          .once("value")
          .then(function (vsnap) {
            const vv = vsnap.val();
            const ac =
              vv && typeof vv === "object" ? Object.keys(vv).length : 0;
            const b = Number(s.totalParticipants) || 0;
            if (ac === b && b > 0) {
              return requestAdvanceOrFinish();
            }
          });
      });
    }, 200);
  }

  function startVotesWatch(db, index) {
    if (lastWatchedIndex === index && votesUnsubscribe) {
      return;
    }
    stopVotesWatch();
    lastWatchedIndex = index;
    const r = db.ref("currentSession/votes/" + index);
    const handler = function (snap) {
      const val = snap.val();
      const a =
        val && typeof val === "object" ? Object.keys(val).length : 0;
      adminSubmitStatus.textContent =
        a + "명 제출 / 전체 " + totalParticipantsB + "명";
      scheduleAutoAdvanceIfComplete(a);
    };
    r.on("value", handler);
    votesUnsubscribe = function () {
      r.off("value", handler);
    };
  }

  function updateEvalImage(targetClass, currentIndex) {
    const tc = (targetClass || "").trim();
    const ci = Number(currentIndex) || 1;
    if (!tc) {
      adminEvalImage.removeAttribute("src");
      adminEvalImage.alt = "반 이름이 설정되지 않았습니다.";
      return;
    }
    adminEvalImage.src = "img/" + tc + "_img_" + ci + ".jpg";
    adminEvalImage.alt = "평가 중: " + tc + " 작품 " + ci;
  }

  const db = firebase.database();
  const pinRef = db.ref("currentSession/pin");
  const usersRef = db.ref("currentSession/users");
  const sessionRef = db.ref("currentSession");

  usersRef.on("value", function (snapshot) {
    const val = snapshot.val();
    const count = val && typeof val === "object" ? Object.keys(val).length : 0;
    userCountEl.textContent = String(count);
  });

  function ensurePinDisplay(pinStr) {
    pinEl.textContent = pinStr;
    pinEl.classList.remove("pin-display--loading");
  }

  sessionRef.once("value").then(function (snap) {
    const s = snap.val() || {};
    const st = s.status;
    prevSessionStatus = st || null;

    if (st === "evaluating") {
      ensurePinDisplay(s.pin != null ? String(s.pin) : "—");
      totalParticipantsB = Number(s.totalParticipants) || 0;
      showEvalUI();
      setEvalSubtitle();
      updateEvalImage(s.targetClass, s.currentIndex);
      startVotesWatch(db, Number(s.currentIndex) || 1);
    } else if (st === "finished") {
      showLobbyUI();
      setFinishedSubtitle();
      if (s.pin != null) {
        ensurePinDisplay(String(s.pin));
      } else {
        const pin = generateFourDigitPin();
        return pinRef
          .set(pin)
          .then(function () {
            ensurePinDisplay(pin);
          })
          .catch(function (err) {
            pinEl.textContent = "PIN 저장 실패";
            pinEl.classList.remove("pin-display--loading");
            console.error(err);
          });
      }
    } else {
      const pin = generateFourDigitPin();
      return pinRef
        .set(pin)
        .then(function () {
          ensurePinDisplay(pin);
        })
        .catch(function (err) {
          pinEl.textContent = "PIN 저장 실패";
          pinEl.classList.remove("pin-display--loading");
          console.error(err);
        });
    }
  });

  sessionRef.on("value", function (snap) {
    const s = snap.val() || {};
    const st = s.status;

    if (st === "evaluating") {
      if (s.totalParticipants != null) {
        totalParticipantsB = Number(s.totalParticipants) || 0;
      }
      showEvalUI();
      setEvalSubtitle();
      updateEvalImage(s.targetClass, s.currentIndex);
      startVotesWatch(db, Number(s.currentIndex) || 1);
      prevSessionStatus = st;
      return;
    }

    stopVotesWatch();
    showLobbyUI();

    if (st === "finished") {
      setFinishedSubtitle();
      if (prevSessionStatus === "evaluating") {
        const pin = generateFourDigitPin();
        pinRef.set(pin).then(function () {
          ensurePinDisplay(pin);
        });
      } else {
        ensurePinDisplay(s.pin != null ? String(s.pin) : "—");
      }
    } else {
      setLobbySubtitle();
      ensurePinDisplay(s.pin != null ? String(s.pin) : "—");
    }

    prevSessionStatus = st || null;
  });

  startEvalBtn.addEventListener("click", function () {
    const className = (targetClassInput.value || "").trim();
    if (!className) {
      alert("평가할 반 이름을 입력해 주세요. (예: 6-1)");
      targetClassInput.focus();
      return;
    }

    const totalImagesRaw = (totalImagesInput.value || "").trim();
    const totalImages = parseInt(totalImagesRaw, 10);
    if (
      !totalImagesRaw ||
      totalImages < 1 ||
      !Number.isFinite(totalImages) ||
      String(totalImages) !== totalImagesRaw
    ) {
      alert("이번 반의 총 그림 개수는 1 이상의 정수로 입력해 주세요.");
      totalImagesInput.focus();
      return;
    }

    startEvalBtn.disabled = true;

    usersRef
      .once("value")
      .then(function (usersSnap) {
        const usersVal = usersSnap.val();
        const b =
          usersVal && typeof usersVal === "object"
            ? Object.keys(usersVal).length
            : 0;
        totalParticipantsB = b;

        return sessionRef.update({
          status: "evaluating",
          targetClass: className,
          currentIndex: 1,
          totalParticipants: b,
          totalImages: totalImages,
        });
      })
      .then(function () {
        adminSubmitStatus.textContent =
          "0명 제출 / 전체 " + totalParticipantsB + "명";
      })
      .catch(function (err) {
        console.error(err);
        alert(
          "평가 시작에 실패했습니다. Firebase 규칙과 네트워크를 확인해 주세요."
        );
      })
      .finally(function () {
        startEvalBtn.disabled = false;
      });
  });

  forceNextImageBtn.addEventListener("click", function () {
    forceNextImageBtn.disabled = true;
    requestAdvanceOrFinish()
      .catch(function (err) {
        console.error(err);
        alert("이동에 실패했습니다. 네트워크를 확인해 주세요.");
      })
      .finally(function () {
        forceNextImageBtn.disabled = false;
      });
  });
})();
