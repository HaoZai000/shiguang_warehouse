// 上海立达学院 (lidapoly.edu.cn) 拾光课程表适配脚本
// 强智教务 jsxsd，课表页 xskb_list.do 在框架 iframe 内，导入前请先在页面上切换好学期
// #kbtable 每大节一行、每天一格；详情 div (class kbcontent) 含 课名[学分][性质] / 老师 /
// 班级(其内文本含 `周次(全部)[节次]`) / 上课地点；同一课程会重复出现在覆盖的多个大节行，需去重
// 校历：POST jxzl_query(xnxq01id) → #kbtable 行 td[0]=周次、td[1].title=该周周一日期

const LIDAPOLY_TIME_SLOTS = [
    { number: 1, startTime: "08:30", endTime: "09:10" },
    { number: 2, startTime: "09:15", endTime: "09:55" },
    { number: 3, startTime: "10:05", endTime: "10:45" },
    { number: 4, startTime: "10:50", endTime: "11:30" },
    { number: 5, startTime: "12:30", endTime: "13:10" },
    { number: 6, startTime: "13:15", endTime: "13:55" },
    { number: 7, startTime: "14:05", endTime: "14:45" },
    { number: 8, startTime: "14:50", endTime: "15:30" },
    { number: 9, startTime: "15:40", endTime: "16:20" },
    { number: 10, startTime: "16:25", endTime: "17:05" },
    { number: 11, startTime: "17:15", endTime: "17:55" },
    { number: 12, startTime: "18:00", endTime: "18:40" },
    { number: 13, startTime: "18:50", endTime: "19:30" },
    { number: 14, startTime: "19:35", endTime: "20:15" },
    { number: 15, startTime: "20:25", endTime: "21:05" },
    { number: 16, startTime: "21:10", endTime: "21:50" }
];

// 周次串："1-16" / "1,3-5" → [1,3,4,5]
function parseWeeks(text) {
    const weeks = [];
    for (const part of String(text).split(/[,,]/)) {
        const range = part.match(/^(\d+)-(\d+)$/);
        if (range) {
            for (let w = Number(range[1]); w <= Number(range[2]); w++) weeks.push(w);
        } else if (/^\d+$/.test(part)) {
            weeks.push(Number(part));
        }
    }
    return [...new Set(weeks)].sort((a, b) => a - b);
}

// 课名 = 详情 div 第一个 <br> 前的文本，去掉尾部 [学分][性质]
function courseNameOf(div) {
    let text = "";
    for (const node of div.childNodes) {
        if (node.nodeName === "BR") break;
        text += node.textContent || "";
    }
    return text.trim().replace(/\s*\[[0-9.]+\]\[[^\]]+\]\s*$/, "").trim();
}

// 解析详情 div：周次节次取自 班级 font 内的 `1-16(全部)[01-02-03节]`
function parseDetailDiv(div, day) {
    const classFont = div.querySelector("font[title=班级]");
    if (!classFont) return null;

    const info = (classFont.textContent || "").replace(/\s+/g, "");
    const matched = info.match(/([\d,\-]+)\(([^)]*)\)\[(\d[\d\-]*)节\]$/);
    if (!matched) return null;

    const isOdd = matched[2].includes("单");
    const isEven = matched[2].includes("双");
    const weeks = parseWeeks(matched[1])
        .filter(w => (!isOdd || w % 2 === 1) && (!isEven || w % 2 === 0));
    if (weeks.length === 0) return null;

    const nums = matched[3].split("-").map(Number);
    const startSection = Math.min(...nums);
    const endSection = Math.max(...nums);
    if (!startSection || endSection > 16) return null;

    const name = courseNameOf(div);
    if (!name) return null;

    const teacherFont = div.querySelector("font[title=老师]");
    const roomFont = div.querySelector("font[title=上课地点]");

    return {
        name: name,
        teacher: teacherFont ? teacherFont.textContent.trim() : "",
        position: roomFont ? roomFont.textContent.trim() : "",
        day: day,
        startSection: startSection,
        endSection: endSection,
        weeks: weeks
    };
}

// 在当前文档与各级 frame 中查找课表页文档（#kbtable）
function findScheduleDoc(doc) {
    if (doc.querySelector("#kbtable div.kbcontent")) return doc;
    for (const frame of doc.querySelectorAll("iframe,frame")) {
        try {
            const found = findScheduleDoc(frame.contentDocument);
            if (found) return found;
        } catch (e) {
            // 跨域 frame 取不到 contentDocument，跳过
        }
    }
    return null;
}

// 课表页学年学期下拉的选中值（如 2026-2027-1）
function readSemesterId(doc) {
    const sel = doc.querySelector("#xnxq01id");
    if (!sel) return null;
    const opt = sel.selectedOptions && sel.selectedOptions[0];
    const value = opt ? String(opt.value).trim() : "";
    return /^\d{4}-\d{4}-\d$/.test(value) ? value : null;
}

// 从课表页 #kbtable 解析课程，同一课程重复出现在多个大节行需去重
function parseCourses(doc) {
    const map = new Map();
    const table = doc.querySelector("#kbtable");

    for (const row of table.rows) {
        if (row.cells.length < 8) continue; // 表头、备注行
        for (let i = 1; i <= 7; i++) {
            const td = row.cells[i];
            if (!td) continue;
            for (const div of td.querySelectorAll("div.kbcontent")) {
                const course = parseDetailDiv(div, i);
                if (!course) continue;
                const key = [course.name, course.teacher, course.position, course.day,
                    course.startSection, course.endSection, course.weeks.join(",")].join("|");
                if (!map.has(key)) map.set(key, course);
            }
        }
    }

    return Array.from(map.values()).sort((a, b) =>
        a.day - b.day || a.startSection - b.startSection || a.name.localeCompare(b.name));
}

// 教学周历：第 1 周周一即开学日期，有效行数即总周数
async function fetchSemesterConfig(semesterId) {
    try {
        const resp = await fetch("/shldzyjsxy_jsxsd/jxzl/jxzl_query?Ves632DSdyV=NEW_XSD_WDZM", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: "xnxq01id=" + encodeURIComponent(semesterId)
        });
        if (!resp.ok) return null;

        const doc = new DOMParser().parseFromString(await resp.text(), "text/html");
        let startDate = "";
        let totalWeeks = 0;

        for (const row of doc.querySelectorAll("#kbtable tr")) {
            const cells = row.cells;
            if (!cells || cells.length < 2) continue;
            const weekNo = cells[0].textContent.trim();
            if (!/^\d+$/.test(weekNo)) continue;
            totalWeeks++;
            if (Number(weekNo) === 1) {
                const matched = (cells[1].getAttribute("title") || "").match(/(\d{4})年(\d{2})月(\d{2})/);
                if (matched) startDate = matched[1] + "-" + matched[2] + "-" + matched[3];
            }
        }

        if (!startDate || !totalWeeks) return null;
        return { semesterStartDate: startDate, semesterTotalWeeks: totalWeeks };
    } catch (e) { return null; }
}

async function runImportFlow() {
    const confirmed = await window.shiguangBridgePromise.showAlert(
        "教务系统课表导入",
        "导入前请先在课表页切换到要导入的学期，再点击导入",
        "好的，开始导入");
    if (!confirmed) { window.shiguangBridge.showToast("用户取消了导入。"); return; }

    const doc = findScheduleDoc(document);
    if (!doc) {
        window.shiguangBridge.showToast("导入失败：未找到课表，请确认已打开学期理论课表页面。");
        return;
    }

    const semesterId = readSemesterId(doc);
    if (!semesterId) {
        window.shiguangBridge.showToast("导入失败：未读取到当前学年学期，请确认在学期理论课表页面。");
        return;
    }

    const courses = parseCourses(doc);
    if (courses.length === 0) {
        window.shiguangBridge.showToast("未解析到课程，请确认课表已加载。");
        return;
    }

    const config = await fetchSemesterConfig(semesterId);

    try {
        await window.shiguangBridgePromise.saveImportedCourses(JSON.stringify(courses));
    } catch (e) {
        window.shiguangBridge.showToast("课程保存失败: " + e.message);
        return;
    }

    if (config) {
        try { await window.shiguangBridgePromise.saveCourseConfig(JSON.stringify(config)); } catch (e) {}
    } else {
        window.shiguangBridge.showToast("未取到开学日期，已跳过课表配置，请在应用内手动设置。");
    }
    try { await window.shiguangBridgePromise.savePresetTimeSlots(JSON.stringify(LIDAPOLY_TIME_SLOTS)); } catch (e) {}

    window.shiguangBridge.showToast("课程导入成功，共导入 " + courses.length + " 门课程！");
    window.shiguangBridge.notifyTaskCompletion();
}

runImportFlow();