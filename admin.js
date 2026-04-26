(function () {
  const pinEl = document.getElementById("pinDisplay");
  const userCountEl = document.getElementById("userCount");
  const lobbyPanel = document.getElementById("lobbyPanel");
  const evalPanel = document.getElementById("evalPanel");
  const adminEvalImage = document.getElementById("adminEvalImage");
  const adminSubmitStatus = document.getElementById("adminSubmitStatus");
  const targetClassInput = document.getElementById("targetClassInput");
  const startEvalBtn = document.getElementById("startEvalBtn");
  const forceNextImageBtn = document.getElementById("forceNextImageBtn");
  const resetSessionEvalBtn = document.getElementById("resetSessionEvalBtn");
  const resetSessionLobbyBtn = document.getElementById("resetSessionLobbyBtn");
  const pageSubtitle = document.getElementById("pageSubtitle");
  const scoresActionsSection = document.getElementById("scoresActionsSection");
  const showScoresBtn = document.getElementById("showScoresBtn");
  const scoresResultCard = document.getElementById("scoresResultCard");
  const scoresRankingList = document.getElementById("scoresRankingList");
  const downloadCsvBtn = document.getElementById("downloadCsvBtn");
  const clearEvalDataBtn = document.getElementById("clearEvalDataBtn");
  const imageModal = document.getElementById("imageModal");
  const imageModalBackdrop = document.getElementById("imageModalBackdrop");
  const imageModalCloseBtn = document.getElementById("imageModalCloseBtn");
  const imageModalImg = document.getElementById("imageModalImg");
  const imageModalTitle = document.getElementById("imageModalTitle");
  const imageModalLoading = document.getElementById("imageModalLoading");
  const adminEvalImageStatus = document.getElementById("adminEvalImageStatus");

  /** 평가 시작 시점에 확정된 전체 참가자 수 (b) */
  let totalParticipantsB = 0;

  /** 평점 보기 / CSV용 */
  let lastRankings = [];
  let cachedTargetClassForScores = "";

  let votesUnsubscribe = null;
  let lastWatchedIndex = null;
  let prevSessionStatus = null;
  let autoAdvanceTimer = null;
  let advanceInFlight = false;

  /** 최근 세션 스냅샷(평점 리스너용) */
  let lastSessionData = {};
  let evalResultsUnsubscribe = null;
  let subscribedEvalClassKey = "";
  let hasAccumulatedVotes = false;
  let adminEvalImageLoadToken = 0;
  let modalImageLoadToken = 0;

  function firebaseSafeKeySegment(raw) {
    return String(raw || "")
      .trim()
      .replace(/[.#$\[\]/\u0000-\u001F]/g, "_");
  }

  function getEffectiveRawTargetClass() {
    const fromSession = (lastSessionData.targetClass || "").trim();
    if (fromSession) {
      return fromSession;
    }
    return (targetClassInput && targetClassInput.value.trim()) || "";
  }

  function hasAnyVotesInEvaluationResults(data) {
    if (!data || typeof data !== "object") {
      return false;
    }
    const imageKeys = Object.keys(data);
    for (var i = 0; i < imageKeys.length; i++) {
      const byUser = data[imageKeys[i]];
      if (!byUser || typeof byUser !== "object") {
        continue;
      }
      const uids = Object.keys(byUser);
      for (var j = 0; j < uids.length; j++) {
        const sc = byUser[uids[j]];
        if (typeof sc === "number" && !Number.isNaN(sc)) {
          return true;
        }
      }
    }
    return false;
  }

  function updateShowScoresButtonUI() {
    if (!showScoresBtn) {
      return;
    }
    const raw = getEffectiveRawTargetClass();
    const key = firebaseSafeKeySegment(raw);
    const canEnable = !!key && hasAccumulatedVotes;
    showScoresBtn.disabled = !canEnable;
    showScoresBtn.classList.toggle("btn--scores-ready", canEnable);
    if (downloadCsvBtn) {
      downloadCsvBtn.disabled = lastRankings.length === 0;
    }
    if (clearEvalDataBtn) {
      clearEvalDataBtn.disabled = !key;
    }
  }

  function resubscribeEvaluationResults() {
    if (typeof evalResultsUnsubscribe === "function") {
      evalResultsUnsubscribe();
      evalResultsUnsubscribe = null;
    }
    const raw = getEffectiveRawTargetClass();
    const key = firebaseSafeKeySegment(raw);
    if (!key) {
      subscribedEvalClassKey = "";
      hasAccumulatedVotes = false;
      updateShowScoresButtonUI();
      return;
    }
    if (key !== subscribedEvalClassKey) {
      subscribedEvalClassKey = key;
      hideScoresResultUI();
      closeImageModal();
      lastRankings = [];
    }
    const r = db.ref("evaluationResults/" + key);
    const handler = function (snap) {
      hasAccumulatedVotes = hasAnyVotesInEvaluationResults(snap.val());
      updateShowScoresButtonUI();
    };
    r.on("value", handler);
    evalResultsUnsubscribe = function () {
      r.off("value", handler);
    };
  }

  function onSessionScoresContextUpdated(s) {
    lastSessionData = s || {};
    resubscribeEvaluationResults();
    updateShowScoresButtonUI();
  }

  function generateFourDigitPin() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  function nextImageUrl(targetClass, currentIndex) {
    const tc = (targetClass || "").trim();
    const cur = Number(currentIndex) || 1;
    if (!tc) {
      return "";
    }
    return "img/" + tc + "_img_" + (cur + 1) + ".jpg";
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

  /**
   * 다음 이미지 파일 존재 여부를 Image(onload/onerror)로 확인한 뒤
   * 존재하면 currentIndex+1, 없으면 status finished.
   */
  function probeNextImageAndAdvance() {
    if (advanceInFlight) {
      return Promise.resolve();
    }
    advanceInFlight = true;
    return sessionRef
      .once("value")
      .then(function (snap) {
        const s = snap.val() || {};
        if (s.status !== "evaluating") {
          advanceInFlight = false;
          return;
        }
        const tc = (s.targetClass || "").trim();
        const cur = Number(s.currentIndex) || 1;
        if (!tc) {
          return sessionRef
            .update({ status: "finished" })
            .finally(function () {
              advanceInFlight = false;
            });
        }
        const nextUrl = nextImageUrl(tc, cur);
        return new Promise(function (resolve, reject) {
          let settled = false;
          const probe = new Image();
          function finishWrite(writePromise) {
            if (settled) {
              return;
            }
            settled = true;
            writePromise
              .then(resolve, reject)
              .finally(function () {
                advanceInFlight = false;
              });
          }
          probe.onload = function () {
            finishWrite(sessionRef.child("currentIndex").set(cur + 1));
          };
          probe.onerror = function () {
            finishWrite(sessionRef.update({ status: "finished" }));
          };
          probe.src = nextUrl;
        });
      })
      .catch(function (err) {
        advanceInFlight = false;
        return Promise.reject(err);
      });
  }

  function resetSessionToLobby() {
    const pin = generateFourDigitPin();
    const votesRef = db.ref("currentSession/votes");
    return votesRef
      .remove()
      .then(function () {
        return usersRef.remove();
      })
      .then(function () {
        return sessionRef.update({
          status: "lobby",
          pin: pin,
          currentIndex: 1,
          targetClass: null,
          totalParticipants: null,
        });
      })
      .then(function () {
        totalParticipantsB = 0;
        ensurePinDisplay(pin);
        stopVotesWatch();
        showLobbyUI();
        setLobbySubtitle();
        prevSessionStatus = "lobby";
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
              return probeNextImageAndAdvance();
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

  function setAdminEvalImageStatus(message) {
    if (!adminEvalImageStatus) {
      return;
    }
    if (message) {
      adminEvalImageStatus.textContent = message;
      adminEvalImageStatus.hidden = false;
    } else {
      adminEvalImageStatus.textContent = "";
      adminEvalImageStatus.hidden = true;
    }
  }

  function updateEvalImage(targetClass, currentIndex) {
    const tc = (targetClass || "").trim();
    const ci = Number(currentIndex) || 1;
    const token = ++adminEvalImageLoadToken;

    if (!tc) {
      adminEvalImage.onload = null;
      adminEvalImage.onerror = null;
      adminEvalImage.removeAttribute("src");
      adminEvalImage.alt = "반 이름이 설정되지 않았습니다.";
      adminEvalImage.classList.remove("eval-image--loading");
      setAdminEvalImageStatus("");
      return;
    }

    const url = "img/" + tc + "_img_" + ci + ".jpg";

    adminEvalImage.onload = null;
    adminEvalImage.onerror = null;
    adminEvalImage.classList.add("eval-image--loading");
    adminEvalImage.alt = "불러오는 중… (" + tc + " · " + ci + ")";
    setAdminEvalImageStatus("이미지를 불러오는 중…");

    function onLoad() {
      if (token !== adminEvalImageLoadToken) {
        return;
      }
      adminEvalImage.onload = null;
      adminEvalImage.onerror = null;
      setAdminEvalImageStatus("");
      adminEvalImage.classList.remove("eval-image--loading");
      adminEvalImage.alt = "평가 중: " + tc + " 작품 " + ci;
    }

    function onError() {
      if (token !== adminEvalImageLoadToken) {
        return;
      }
      adminEvalImage.onload = null;
      adminEvalImage.onerror = null;
      adminEvalImage.classList.remove("eval-image--loading");
      adminEvalImage.removeAttribute("src");
      adminEvalImage.alt = "이미지 없음";
      setAdminEvalImageStatus(
        "이미지를 찾을 수 없습니다. img/" +
          tc +
          "_img_" +
          ci +
          ".jpg 파일이 있는지 확인해 주세요."
      );
    }

    adminEvalImage.onload = onLoad;
    adminEvalImage.onerror = onError;
    adminEvalImage.src = url;
    if (adminEvalImage.complete && adminEvalImage.naturalWidth) {
      adminEvalImage.onload = null;
      adminEvalImage.onerror = null;
      onLoad();
    }
  }

  function hideScoresResultUI() {
    if (scoresResultCard) {
      scoresResultCard.hidden = true;
    }
    if (scoresRankingList) {
      scoresRankingList.innerHTML = "";
    }
  }

  function aggregateVotesByImage(votesRoot) {
    const rows = [];
    if (!votesRoot || typeof votesRoot !== "object") {
      return rows;
    }
    Object.keys(votesRoot).forEach(function (key) {
      const idx = parseInt(key, 10);
      if (!Number.isFinite(idx)) {
        return;
      }
      const perUser = votesRoot[key];
      if (!perUser || typeof perUser !== "object") {
        return;
      }
      const scores = [];
      Object.keys(perUser).forEach(function (uid) {
        const v = perUser[uid];
        if (typeof v === "number" && !Number.isNaN(v)) {
          scores.push(v);
        }
      });
      if (scores.length === 0) {
        return;
      }
      const sum = scores.reduce(function (a, b) {
        return a + b;
      }, 0);
      const avg = sum / scores.length;
      rows.push({
        imageIndex: idx,
        avg: avg,
        count: scores.length,
      });
    });
    rows.sort(function (a, b) {
      if (b.avg !== a.avg) {
        return b.avg - a.avg;
      }
      return a.imageIndex - b.imageIndex;
    });
    return rows.map(function (r, i) {
      return {
        rank: i + 1,
        imageIndex: r.imageIndex,
        avg: r.avg,
        count: r.count,
      };
    });
  }

  function renderRankingList(rankings, targetClass) {
    if (!scoresRankingList) {
      return;
    }
    scoresRankingList.innerHTML = "";
    const tc = (targetClass || "").trim();
    rankings.forEach(function (r) {
      const li = document.createElement("li");
      li.className = "ranking-list__item";
      li.setAttribute("data-image-index", String(r.imageIndex));
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      li.textContent =
        r.rank +
        "등: " +
        r.imageIndex +
        "번 그림 - " +
        r.avg.toFixed(1) +
        "점 (참가 " +
        r.count +
        "명)";
      if (!tc) {
        li.classList.add("ranking-list__item--disabled");
        li.setAttribute("aria-disabled", "true");
      }
      scoresRankingList.appendChild(li);
    });
  }

  function openImageModal(imageIndex, targetClass) {
    const tc = (targetClass || "").trim();
    if (!tc || !imageModal || !imageModalImg) {
      return;
    }
    const token = ++modalImageLoadToken;
    if (imageModalTitle) {
      imageModalTitle.textContent = String(imageIndex) + "번 그림";
    }
    imageModal.hidden = false;
    imageModal.setAttribute("aria-hidden", "false");
    imageModalImg.removeAttribute("src");
    imageModalImg.classList.add("eval-image--loading");
    if (imageModalLoading) {
      imageModalLoading.textContent = "이미지를 불러오는 중…";
      imageModalLoading.hidden = false;
    }

    const url = "img/" + tc + "_img_" + imageIndex + ".jpg";

    function doneOk() {
      if (token !== modalImageLoadToken) {
        return;
      }
      imageModalImg.onload = null;
      imageModalImg.onerror = null;
      if (imageModalLoading) {
        imageModalLoading.hidden = true;
        imageModalLoading.textContent = "";
      }
      imageModalImg.classList.remove("eval-image--loading");
      imageModalImg.alt = tc + " 작품 " + imageIndex;
    }

    function doneErr() {
      if (token !== modalImageLoadToken) {
        return;
      }
      imageModalImg.onload = null;
      imageModalImg.onerror = null;
      imageModalImg.classList.remove("eval-image--loading");
      imageModalImg.removeAttribute("src");
      if (imageModalLoading) {
        imageModalLoading.textContent =
          "이미지를 불러올 수 없습니다. img 폴더에 파일이 있는지 확인해 주세요.";
        imageModalLoading.hidden = false;
      }
    }

    imageModalImg.onload = doneOk;
    imageModalImg.onerror = doneErr;
    imageModalImg.src = url;
    if (imageModalImg.complete && imageModalImg.naturalWidth) {
      imageModalImg.onload = null;
      imageModalImg.onerror = null;
      doneOk();
    }
  }

  function closeImageModal() {
    modalImageLoadToken += 1;
    if (!imageModal) {
      return;
    }
    imageModal.hidden = true;
    imageModal.setAttribute("aria-hidden", "true");
    if (imageModalLoading) {
      imageModalLoading.hidden = true;
      imageModalLoading.textContent = "";
    }
    if (imageModalImg) {
      imageModalImg.removeAttribute("src");
      imageModalImg.classList.remove("eval-image--loading");
    }
  }

  function safeCsvFilenamePart(name) {
    const s = String(name || "").trim();
    if (!s) {
      return "class";
    }
    return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  }

  function downloadRankingsCsv() {
    if (!lastRankings.length) {
      alert("다운로드할 순위 데이터가 없습니다. 먼저 「평점 보기」를 눌러 주세요.");
      return;
    }
    const base = safeCsvFilenamePart(cachedTargetClassForScores);
    const filename = base + "_평가결과.csv";
    const lines = ["\uFEFF순위,이미지 번호,평균 점수,참가자 수"];
    lastRankings.forEach(function (r) {
      lines.push(
        r.rank +
          "," +
          r.imageIndex +
          "," +
          r.avg.toFixed(1) +
          "," +
          r.count
      );
    });
    const blob = new Blob([lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
      onSessionScoresContextUpdated(s);
    } else if (st === "finished") {
      showLobbyUI();
      setFinishedSubtitle();
      if (s.pin != null) {
        ensurePinDisplay(String(s.pin));
        onSessionScoresContextUpdated(s);
      } else {
        const pin = generateFourDigitPin();
        return pinRef
          .set(pin)
          .then(function () {
            ensurePinDisplay(pin);
            onSessionScoresContextUpdated(s);
          })
          .catch(function (err) {
            pinEl.textContent = "PIN 저장 실패";
            pinEl.classList.remove("pin-display--loading");
            console.error(err);
            onSessionScoresContextUpdated(s);
          });
      }
    } else {
      const pin = generateFourDigitPin();
      return pinRef
        .set(pin)
        .then(function () {
          ensurePinDisplay(pin);
          onSessionScoresContextUpdated(s);
        })
        .catch(function (err) {
          pinEl.textContent = "PIN 저장 실패";
          pinEl.classList.remove("pin-display--loading");
          console.error(err);
          onSessionScoresContextUpdated(s);
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
      onSessionScoresContextUpdated(s);
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
    onSessionScoresContextUpdated(s);
  });

  startEvalBtn.addEventListener("click", function () {
    const className = (targetClassInput.value || "").trim();
    if (!className) {
      alert("평가할 반 이름을 입력해 주세요. (예: 6-1)");
      targetClassInput.focus();
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
    probeNextImageAndAdvance()
      .catch(function (err) {
        console.error(err);
        alert(
          "처리에 실패했습니다. Firebase 규칙(쓰기 권한)과 네트워크를 확인해 주세요."
        );
      })
      .finally(function () {
        forceNextImageBtn.disabled = false;
      });
  });

  function bindResetSession(btn) {
    if (!btn) {
      return;
    }
    btn.addEventListener("click", function () {
      if (
        !confirm(
          "평가를 중단하고 세션을 초기화할까요?\n\n" +
            "· 참가자 목록과 모든 투표가 삭제됩니다.\n" +
            "· PIN이 새로 발급됩니다.\n" +
            "· 학생은 다시 입장해야 합니다."
        )
      ) {
        return;
      }
      btn.disabled = true;
      resetSessionToLobby()
        .catch(function (err) {
          console.error(err);
          alert(
            "초기화에 실패했습니다. Firebase 규칙(삭제·쓰기 권한)을 확인해 주세요."
          );
        })
        .finally(function () {
          btn.disabled = false;
        });
    });
  }

  bindResetSession(resetSessionEvalBtn);
  bindResetSession(resetSessionLobbyBtn);

  if (showScoresBtn) {
    showScoresBtn.addEventListener("click", function () {
      if (showScoresBtn.disabled) {
        return;
      }
      showScoresBtn.disabled = true;
      const raw = getEffectiveRawTargetClass();
      const key = firebaseSafeKeySegment(raw);
      if (!key) {
        alert("반 이름을 입력하거나 진행 중인 세션의 반 정보가 필요합니다.");
        updateShowScoresButtonUI();
        return;
      }
      db
        .ref("evaluationResults/" + key)
        .once("value")
        .then(function (snap) {
          cachedTargetClassForScores = raw;
          const rankings = aggregateVotesByImage(snap.val());
          lastRankings = rankings;
          renderRankingList(rankings, cachedTargetClassForScores);
          if (scoresResultCard) {
            scoresResultCard.hidden = false;
          }
          if (rankings.length === 0 && scoresRankingList) {
            scoresRankingList.innerHTML =
              '<li class="ranking-list__empty">누적된 평점이 없습니다.</li>';
          }
        })
        .catch(function (err) {
          console.error(err);
          alert("평점 데이터를 불러오지 못했습니다.");
        })
        .finally(function () {
          updateShowScoresButtonUI();
        });
    });
  }

  if (targetClassInput) {
    targetClassInput.addEventListener("input", function () {
      onSessionScoresContextUpdated(lastSessionData);
    });
  }

  if (downloadCsvBtn) {
    downloadCsvBtn.addEventListener("click", function () {
      if (downloadCsvBtn.disabled) {
        return;
      }
      downloadRankingsCsv();
    });
  }

  if (clearEvalDataBtn) {
    clearEvalDataBtn.addEventListener("click", function () {
      if (clearEvalDataBtn.disabled) {
        return;
      }
      const raw = getEffectiveRawTargetClass();
      const key = firebaseSafeKeySegment(raw);
      if (!raw || !key) {
        alert("삭제할 반을 먼저 지정해 주세요. (평가할 반 입력 또는 진행 중인 세션의 반)");
        return;
      }
      const ok = window.confirm(
        "정말로 " +
          raw +
          "의 모든 평가 데이터를 삭제하시겠습니까? 삭제된 데이터는 복구할 수 없습니다."
      );
      if (!ok) {
        return;
      }
      clearEvalDataBtn.disabled = true;
      db
        .ref("evaluationResults/" + key)
        .remove()
        .then(function () {
          hasAccumulatedVotes = false;
          lastRankings = [];
          cachedTargetClassForScores = "";
          hideScoresResultUI();
          closeImageModal();
          alert("데이터가 초기화되었습니다.");
          updateShowScoresButtonUI();
        })
        .catch(function (err) {
          console.error(err);
          alert(
            "데이터를 삭제하지 못했습니다. Firebase 규칙(삭제 권한)과 네트워크를 확인해 주세요."
          );
          updateShowScoresButtonUI();
        });
    });
  }

  if (scoresRankingList) {
    scoresRankingList.addEventListener("click", function (e) {
      const li = e.target.closest(".ranking-list__item");
      if (!li || li.classList.contains("ranking-list__item--disabled")) {
        return;
      }
      const idx = parseInt(li.getAttribute("data-image-index") || "0", 10);
      if (!Number.isFinite(idx)) {
        return;
      }
      openImageModal(idx, cachedTargetClassForScores);
    });
    scoresRankingList.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") {
        return;
      }
      const li = e.target.closest(".ranking-list__item");
      if (!li || li.classList.contains("ranking-list__item--disabled")) {
        return;
      }
      e.preventDefault();
      const idx = parseInt(li.getAttribute("data-image-index") || "0", 10);
      if (!Number.isFinite(idx)) {
        return;
      }
      openImageModal(idx, cachedTargetClassForScores);
    });
  }

  if (imageModalBackdrop) {
    imageModalBackdrop.addEventListener("click", closeImageModal);
  }
  if (imageModalCloseBtn) {
    imageModalCloseBtn.addEventListener("click", closeImageModal);
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && imageModal && !imageModal.hidden) {
      closeImageModal();
    }
  });
})();
