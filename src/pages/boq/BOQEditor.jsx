import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Save,
  Copy,
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  FileText,
  Check,
  X,
  Send,
  MoreVertical,
  Hash,
  Layers,
  Wallet,
  Percent,
  Calendar,
  StickyNote,
  Sparkles,
  AlertTriangle,
  Info,
  CheckCircle2,
  Calculator,
  Building2,
  User,
  BookOpen,
  GripVertical,
  Search,
  RotateCcw,
  Link2,
  Edit3,
  ShieldCheck,
  PackageCheck,
  Package,
  Ruler,
  Eye,
  History,
  List,
} from "lucide-react";
import {
  createBoq,
  getBoq,
  saveBoq,
  deleteBoq,
  duplicateBoq,
  computeItemAmount,
  computeItemQty,
  computeBoqTotals,
  resolveGstTreatment,
  validateBoqForSend,
  blankItem,
  blankSection,
  DIMENSIONAL_UNITS,
} from "../../data/boqStorage";
import { getOrgProfile } from "../../data/orgProfile";
import { PAYMENT_MILESTONES } from "../../data/MilestoneConfig";
import { getPresetKeys } from "../../data/QuotePresets";
import { UNITS, HSN_SUGGESTIONS } from "../../data/boqUnits";
import { getAllClients, clientToBoqFields } from "../../data/clientStorage";
import {
  listLibrary,
  libraryToItem,
  incrementUsage,
} from "../../data/itemLibrary";
import { listMaterials } from "../../data/materialLibrary";
import BOQPreview, {
  MaterialSheetPreview,
  MeasurementSheetPreview,
} from "./BOQPreview";
import { formatAmount } from "../../utils/formatAmount";
import ItemFormModal from "../../components/ItemFormModal";
import CategorySelect from "../../components/CategorySelect";
import {
  BulletListEditor,
  CollapsiblePanel,
  CommercialValue,
  ConfirmDialog,
  Field,
  Row,
  SendValidationDialog,
  SignoffCheck,
  SignoffField,
  Toast,
} from "../../components/boq/BOQEditorPrimitives";
import { getScheduleConfig } from "../../data/scheduleConfig";
import { roomColor } from "../../data/categoryColors";
import {
  getContractByClient,
  linkBoqToContract,
} from "../../data/contractStorage";
import {
  computeRecipe,
  materialsById as mkMatById,
  recipeToMaterials,
} from "../../data/rateBuildup";

const inputBase =
  "bg-white border border-bordergray text-[12px] text-textcolor rounded-lg px-3 py-2 w-full focus:outline-none focus:border-select-blue focus:ring-2 focus:ring-select-blue/15 transition-all placeholder:text-text-subtle";

const compactInput =
  "bg-white border border-bordergray text-[11.5px] text-textcolor rounded-md px-2 py-1.5 w-full focus:outline-none focus:border-select-blue focus:ring-1 focus:ring-select-blue/20 placeholder:text-text-subtle";

const STATUS_STYLES = {
  draft: {
    bg: "bg-slate-100",
    text: "text-slate-700",
    border: "border-slate-200",
  },
  sent: { bg: "bg-blue-100", text: "text-blue-700", border: "border-blue-200" },
  approved: {
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  revised: {
    bg: "bg-amber-100",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  issued_for_tender: {
    bg: "bg-amber-100",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  signed: {
    bg: "bg-purple-100",
    text: "text-purple-700",
    border: "border-purple-200",
  },
  issued_for_procurement: {
    bg: "bg-indigo-100",
    text: "text-indigo-700",
    border: "border-indigo-200",
  },
  procurement: {
    bg: "bg-indigo-100",
    text: "text-indigo-700",
    border: "border-indigo-200",
  },
};

const LOCKED_STATUSES = ["sent", "approved", "issued_for_tender", "signed", "issued_for_procurement", "procurement"];
const isLockedStatus = (status) => LOCKED_STATUSES.includes(status);
const SIGNOFF_LOCKED_STATUSES = ["signed", "issued_for_procurement", "procurement"];
const isSignoffLockedStatus = (status) => SIGNOFF_LOCKED_STATUSES.includes(status);

const DEFAULT_APPROVAL = {
  preparedBy: "",
  reviewedBy: "",
  approvedBy: "",
  clientAcceptedBy: "",
  preparedAt: "",
  sentAt: "",
  reviewedAt: "",
  approvedAt: "",
  clientAcceptedAt: "",
  checklist: {
    measurementsChecked: false,
    ratesChecked: false,
    taxChecked: false,
    termsChecked: false,
  },
  remarks: "",
};

const mergeApproval = (approval = {}) => ({
  ...DEFAULT_APPROVAL,
  ...approval,
  checklist: {
    ...DEFAULT_APPROVAL.checklist,
    ...(approval.checklist || {}),
  },
});

const createAuditEntry = ({
  boq,
  action,
  label,
  actor,
  details = "",
  at = new Date().toISOString(),
}) => ({
  id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
  action,
  label,
  actor: actor || "System",
  details,
  at,
  status: boq?.status || "draft",
  revision: boq?.revision || 1,
});

const appendAuditTrail = (boq, entry) => [
  ...(boq?.auditTrail || []),
  createAuditEntry({ boq, ...entry }),
];

const DEFAULT_PROCUREMENT = {
  issued: false,
  issuedAt: "",
  issuedBy: "",
  contractId: "",
};

const countMaterials = (record) =>
  (record?.sections || []).reduce(
    (sum, section) =>
      sum +
      (section.items || []).reduce(
        (itemSum, item) => itemSum + (item.materials || []).length,
        0,
      ),
    0,
  );

const BOQEditor = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();

  const [boq, setBoq] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [toast, setToast] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  // { blocks, warnings } from validateBoqForSend, shown in SendValidationDialog.
  const [sendValidation, setSendValidation] = useState(null);
  const [showSeedPicker, setShowSeedPicker] = useState(false);
  const [libraryPickerSection, setLibraryPickerSection] = useState(null);
  const [showSectionPicker, setShowSectionPicker] = useState(false);
  // Section id currently adding a line item through the full Item Form modal.
  const [itemFormSection, setItemFormSection] = useState(null);
  // { sectionId, itemId } of the line item currently being edited in the modal.
  const [editingItem, setEditingItem] = useState(null);
  const [itemSearch, setItemSearch] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [showMeasurementSheet, setShowMeasurementSheet] = useState(false);
  const [showMaterialSheet, setShowMaterialSheet] = useState(false);
  const [viewingSnapshot, setViewingSnapshot] = useState(null);
  const [groupMode, setGroupMode] = useState("section"); // "section" | "room" | "work"
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  // Items inserted from the library are compact-by-default; user can expand
  // any of them to override rate / HSN / GST. Tracked by item id.
  const [expandedLinked, setExpandedLinked] = useState({});

  // Load or create
  useEffect(() => {
    if (id === "new" || !id) {
      const seed = searchParams.get("preset");
      const fresh = createBoq({ basedOnPreset: seed || null });
      saveBoq(fresh);
      // Replace URL so refresh keeps the same BOQ id
      navigate(`/boq/${fresh.id}`, { replace: true });
      setBoq(fresh);
      // Expand first section by default
      if (fresh.sections.length > 0) {
        setExpanded({ [fresh.sections[0].id]: true });
      }
      return;
    }
    const existing = getBoq(id);
    if (existing) {
      setBoq(existing);
      if (existing.sections?.[0]) {
        setExpanded({ [existing.sections[0].id]: true });
      }
    } else {
      // No matching BOQ — bounce to list
      navigate("/boq", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Auto-save on change
  useEffect(() => {
    if (!boq) return;
    const t = setTimeout(() => saveBoq(boq), 400);
    return () => clearTimeout(t);
  }, [boq]);

  const showToast = (message, type = "success") => {
    setToast({ message, type, id: Date.now() });
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Mutations ────────────────────────────────────────────────────────────
  const updateInternal = (changes) =>
    setBoq((prev) => ({
      ...prev,
      ...(typeof changes === "function" ? changes(prev) : changes),
    }));

  const canEditBoq = (record = boq) => !isLockedStatus(record?.status);
  const canEditSignoff = (record = boq) => !isSignoffLockedStatus(record?.status);
  const showLockedToast = () =>
    showToast("Create a revision before editing this issued BOQ.", "info");
  const showSignoffLockedToast = () =>
    showToast("Create a revision before changing approved signoff details.", "info");

  const update = (changes) =>
    setBoq((prev) => (canEditBoq(prev) ? { ...prev, ...changes } : prev));

  const updateClient = (changes) =>
    setBoq((prev) =>
      canEditBoq(prev)
        ? { ...prev, client: { ...prev.client, ...changes } }
        : prev,
    );

  const updateProject = (changes) =>
    setBoq((prev) =>
      canEditBoq(prev)
        ? { ...prev, project: { ...prev.project, ...changes } }
        : prev,
    );

  const updateApproval = (changes) =>
    setBoq((prev) => {
      if (!canEditSignoff(prev)) return prev;
      const current = mergeApproval(prev.approval);
      return {
        ...prev,
        approval: {
          ...current,
          ...(typeof changes === "function" ? changes(current) : changes),
        },
      };
    });

  const updateApprovalChecklist = (key, checked) =>
    updateApproval((approval) => ({
      checklist: {
        ...approval.checklist,
        [key]: checked,
      },
    }));

  const addSection = () => {
    if (!canEditBoq()) {
      showLockedToast();
      return;
    }
    setBoq((prev) => {
      if (!canEditBoq(prev)) return prev;
      const sec = blankSection(`Section ${(prev.sections?.length || 0) + 1}`);
      const next = { ...prev, sections: [...(prev.sections || []), sec] };
      setExpanded((p) => ({ ...p, [sec.id]: true }));
      // Immediately open the Item Form modal so the user adds the first
      // line item without an extra click. "Add Scope" = section + first item.
      setItemFormSection(sec.id);
      return next;
    });
  };

  const updateSection = (sid, changes) => {
    setBoq((prev) => ({
      ...prev,
      sections: canEditBoq(prev)
        ? prev.sections.map((s) => (s.id === sid ? { ...s, ...changes } : s))
        : prev.sections,
    }));
  };

  const removeSection = (sid) => {
    if (!canEditBoq()) {
      showLockedToast();
      return;
    }
    setBoq((prev) => ({
      ...prev,
      sections: canEditBoq(prev)
        ? prev.sections.filter((s) => s.id !== sid)
        : prev.sections,
    }));
    showToast("Section removed", "info");
  };

  const duplicateSection = (sid) => {
    if (!canEditBoq()) {
      showLockedToast();
      return;
    }
    setBoq((prev) => {
      if (!canEditBoq(prev)) return prev;
      const idx = prev.sections.findIndex((s) => s.id === sid);
      if (idx < 0) return prev;
      const src = prev.sections[idx];
      const clone = {
        ...JSON.parse(JSON.stringify(src)),
        id: `${src.id}_c${Date.now().toString(36).slice(-3)}`,
        name: `${src.name} (Copy)`,
        items: (src.items || []).map((it) => ({
          ...it,
          id: `${it.id}_c${Date.now().toString(36).slice(-3)}`,
        })),
      };
      const sections = [...prev.sections];
      sections.splice(idx + 1, 0, clone);
      setExpanded((p) => ({ ...p, [clone.id]: true }));
      return { ...prev, sections };
    });
    showToast("Section duplicated", "success");
  };

  // Convert the form's flat shape into the BOQ line-item shape (with the
  // nested dimensions object). Shared by both add and edit flows.
  const formToBoqItem = (form, base = {}) => {
    const L = Number(form.length) || 0;
    const B = Number(form.breadth) || 0;
    const H = Number(form.height) || 0;
    return {
      ...base,
      masterId: form.masterId ?? base.masterId ?? null,
      description: form.description || "",
      spec: form.spec || "",
      hsn: form.hsn || "",
      qty: Number(form.qty) || 1,
      unit: form.unit || "nos",
      rate: Number(form.rate) || 0,
      gstPercent: Number(form.gstPercent) || 18,
      dimensions: {
        enabled: L > 0 || B > 0 || H > 0,
        length: L,
        breadth: B,
        height: H,
      },
      materials: form.materials ? form.materials.map((m) => ({ ...m })) : [],
    };
  };

  // Convert a BOQ line-item back into the flat form shape so the Item Form
  // modal can be opened with the row's current values pre-filled.
  const boqItemToForm = (item) => ({
    id: item.id,
    masterId: item.masterId || null,
    description: item.description || "",
    spec: item.spec || "",
    category: item.category || "",
    hsn: item.hsn || "",
    unit: item.unit || "nos",
    length: item.dimensions?.length || 0,
    breadth: item.dimensions?.breadth || 0,
    height: item.dimensions?.height || 0,
    qty: Number(item.qty) || 0,
    rate: Number(item.rate) || 0,
    gstPercent: Number(item.gstPercent) || 18,
    materials: item.materials ? item.materials.map((m) => ({ ...m })) : [],
  });

  // Save handler for "Add Line Item" — appends a new BOQ item to the section.
  const handleItemFormSave = (form) => {
    if (!canEditBoq()) {
      showLockedToast();
      return;
    }
    const sid = itemFormSection;
    if (!sid) return;
    const newItem = formToBoqItem(form, {
      ...blankItem(),
      source: "manual",
      isVariation: !!boq.siteID,
    });
    setBoq((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sid ? { ...s, items: [...(s.items || []), newItem] } : s,
      ),
    }));
    setExpanded((p) => ({ ...p, [sid]: true }));
    if (form.masterId) incrementUsage(form.masterId);
    setItemFormSection(null);
    showToast("Item added", "success");
  };

  // Save handler for clicking an existing row — updates the item in place.
  const handleItemEditSave = (form) => {
    if (!canEditBoq()) {
      showLockedToast();
      return;
    }
    if (!editingItem) return;
    const { sectionId, itemId } = editingItem;
    setBoq((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              items: s.items.map((it) =>
                it.id === itemId ? formToBoqItem(form, it) : it,
              ),
            }
          : s,
      ),
    }));
    setEditingItem(null);
    showToast("Item updated", "success");
  };

  // Quick-quote shortcut: create a new section pre-populated with all library
  // items in the chosen category. Each item carries `masterId` so it renders
  // compact-by-default (just qty/dims editable, rate/HSN hidden behind Override).
  const addSectionFromCategory = (label, categoryValue, libItems) => {
    if (!canEditBoq()) {
      showLockedToast();
      return;
    }
    const sec = blankSection(label);
    sec.category = categoryValue;
    sec.items = libItems.map((lib) => ({
      ...blankItem(),
      ...libraryToItem(lib),
      source: "manual",
      isVariation: !!boq.siteID,
    }));
    setBoq((prev) => ({
      ...prev,
      sections: [...(prev.sections || []), sec],
    }));
    libItems.forEach((lib) => incrementUsage(lib.id));
    setExpanded((p) => ({ ...p, [sec.id]: true }));
    setShowSectionPicker(false);
    showToast(
      `${label} section added with ${libItems.length} item${libItems.length === 1 ? "" : "s"}`,
      "success",
    );
  };

  const insertLibraryItems = (sid, libItems) => {
    if (!canEditBoq()) {
      showLockedToast();
      return;
    }
    const newItems = libItems.map((lib) => ({
      ...blankItem(),
      ...libraryToItem(lib),
      source: "manual",
      isVariation: !!boq.siteID,
    }));
    setBoq((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sid ? { ...s, items: [...(s.items || []), ...newItems] } : s,
      ),
    }));
    libItems.forEach((lib) => incrementUsage(lib.id));
    setExpanded((p) => ({ ...p, [sid]: true }));
    showToast(
      `Inserted ${libItems.length} item${libItems.length === 1 ? "" : "s"} from library`,
      "success",
    );
  };

  const updateItem = (sid, iid, changes) => {
    setBoq((prev) => ({
      ...prev,
      sections: canEditBoq(prev)
        ? prev.sections.map((s) =>
            s.id === sid
              ? {
                  ...s,
                  items: s.items.map((it) =>
                    it.id === iid ? { ...it, ...changes } : it,
                  ),
                }
              : s,
          )
        : prev.sections,
    }));
  };

  const removeItem = (sid, iid) => {
    if (!canEditBoq()) {
      showLockedToast();
      return;
    }
    setBoq((prev) => ({
      ...prev,
      sections: canEditBoq(prev)
        ? prev.sections.map((s) =>
            s.id === sid
              ? { ...s, items: s.items.filter((it) => it.id !== iid) }
              : s,
          )
        : prev.sections,
    }));
  };

  const duplicateItem = (sid, iid) => {
    if (!canEditBoq()) {
      showLockedToast();
      return;
    }
    setBoq((prev) => ({
      ...prev,
      sections: canEditBoq(prev)
        ? prev.sections.map((s) => {
            if (s.id !== sid) return s;
            const idx = s.items.findIndex((it) => it.id === iid);
            if (idx < 0) return s;
            const src = s.items[idx];
            const clone = {
              ...JSON.parse(JSON.stringify(src)),
              id: `${src.id}_c${Date.now().toString(36).slice(-3)}`,
            };
            const items = [...s.items];
            items.splice(idx + 1, 0, clone);
            return { ...s, items };
          })
        : prev.sections,
    }));
  };

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (!canEditBoq()) {
      showLockedToast();
      return;
    }
    saveBoq(boq);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
    showToast("All changes saved", "success");
  };

  const finalizeSend = () => {
    // Stamp the firm's current org profile onto the BOQ so this document's
    // header/GSTIN/bank details never silently change if the profile is
    // edited later — drafts always read the live profile, sent docs don't.
    updateInternal((prev) => {
      const approval = mergeApproval(prev.approval);
      const now = new Date().toISOString();
      return {
        status: "sent",
        orgSnapshot: getOrgProfile(),
        approval: {
          ...approval,
          preparedAt: approval.preparedAt || now,
          sentAt: now,
        },
        auditTrail: appendAuditTrail(prev, {
          action: "sent",
          label: "Marked Sent",
          actor: approval.preparedBy || "Prepared by user",
          details: "BOQ issued to client and locked for controlled revision.",
          at: now,
        }),
      };
    });
    setSendValidation(null);
    showToast("BOQ marked as sent", "success");
  };

  const handleSend = () => {
    const { blocks, warnings } = validateBoqForSend(boq);
    if (blocks.length > 0 || warnings.length > 0) {
      setSendValidation({ blocks, warnings });
      return;
    }
    finalizeSend();
  };

  const finalizeApprove = () => {
    updateInternal((prev) => {
      const approval = mergeApproval(prev.approval);
      const now = new Date().toISOString();
      return {
        status: "approved",
        approval: {
          ...approval,
          reviewedAt: approval.reviewedAt || now,
          approvedAt: now,
        },
        auditTrail: appendAuditTrail(prev, {
          action: "approved",
          label: "Approved",
          actor: approval.approvedBy || approval.reviewedBy || "Approver",
          details: "BOQ approval completed for this revision.",
          at: now,
        }),
      };
    });
    showToast("BOQ approved", "success");
  };

  const handleApprove = () => {
    const approval = mergeApproval(boq.approval);
    const checklistComplete = Object.values(approval.checklist).every(Boolean);
    const missingPeople = [
      !approval.reviewedBy && "reviewer",
      !approval.approvedBy && "approver",
    ].filter(Boolean);

    if (!checklistComplete || missingPeople.length > 0) {
      setConfirmDialog({
        title: "Approve with incomplete signoff?",
        message: [
          missingPeople.length > 0
            ? `Missing ${missingPeople.join(" and ")} name.`
            : "",
          !checklistComplete ? "Review checklist is not fully complete." : "",
        ]
          .filter(Boolean)
          .join(" "),
        confirmLabel: "Approve Anyway",
        onConfirm: finalizeApprove,
      });
      return;
    }

    finalizeApprove();
  };

  const handleSign = () => {
    updateInternal((prev) => {
      const approval = mergeApproval(prev.approval);
      const now = new Date().toISOString();
      return {
        status: "signed",
        approval: {
          ...approval,
          clientAcceptedBy:
            approval.clientAcceptedBy || prev.client?.name || "Client",
          clientAcceptedAt: approval.clientAcceptedAt || now,
        },
        auditTrail: appendAuditTrail(prev, {
          action: "signed",
          label: "Client Signed",
          actor: approval.clientAcceptedBy || prev.client?.name || "Client",
          details: "Client acceptance recorded.",
          at: now,
        }),
      };
    });
    showToast("BOQ marked as signed", "success");
  };

  const handleIssueForTender = () => {
    setConfirmDialog({
      title: "Issue for tender?",
      message: `${boq.id} will be locked and marked as issued for vendor tendering.`,
      confirmLabel: "Issue Tender",
      onConfirm: () => {
        updateInternal((prev) => {
          const approval = mergeApproval(prev.approval);
          const now = new Date().toISOString();
          return {
            status: "issued_for_tender",
            auditTrail: appendAuditTrail(prev, {
              action: "issued_for_tender",
              label: "Issued for Tender",
              actor: approval.approvedBy || approval.reviewedBy || "Approver",
              details: "BOQ issued for tendering to vendors.",
              at: now,
            }),
          };
        });
        showToast("BOQ issued for tender", "success");
      },
    });
  };

  const handleIssueForProcurement = () => {
    const materialCount = countMaterials(boq);
    if (materialCount === 0) {
      showToast("Add BOQ materials before issuing for procurement.", "info");
      return;
    }

    const contract = boq.client?.id ? getContractByClient(boq.client.id) : null;
    if (!contract?.id) {
      showToast(
        "Link this BOQ to a signed client contract before issuing for procurement.",
        "info",
      );
      return;
    }

    setConfirmDialog({
      title: "Issue for procurement?",
      message: `This will lock ${boq.id} as the procurement basis and link it to ${contract.id}.`,
      confirmLabel: "Issue Procurement",
      onConfirm: () => {
        const now = new Date().toISOString();
        linkBoqToContract(contract.id, boq.id);
        updateInternal((prev) => {
          const approval = mergeApproval(prev.approval);
          const issuedBy =
            approval.clientAcceptedBy ||
            approval.approvedBy ||
            prev.client?.name ||
            "Authorized user";
          return {
            status: "issued_for_procurement",
            procurement: {
              ...DEFAULT_PROCUREMENT,
              ...(prev.procurement || {}),
              issued: true,
              issuedAt: now,
              issuedBy,
              contractId: contract.id,
            },
            auditTrail: appendAuditTrail(prev, {
              action: "issued_for_procurement",
              label: "Issued for Procurement",
              actor: issuedBy,
              details: `Linked to contract ${contract.id} for RFQ and PO takeoff.`,
              at: now,
            }),
          };
        });
        showToast("BOQ issued for procurement", "success");
      },
    });
  };

  const handleCreateRevision = () => {
    setConfirmDialog({
      title: "Create editable revision?",
      message: `${boq.id} Rev ${boq.revision || 1} is ${boq.status}. This will unlock a new draft revision while preserving the same BOQ record.`,
      confirmLabel: "Create Revision",
      onConfirm: () => {
        updateInternal({
          status: "draft",
          revision: (Number(boq.revision) || 1) + 1,
          orgSnapshot: null,
          procurement: DEFAULT_PROCUREMENT,
          approval: {
            ...DEFAULT_APPROVAL,
            preparedBy: mergeApproval(boq.approval).preparedBy,
            reviewedBy: mergeApproval(boq.approval).reviewedBy,
            approvedBy: mergeApproval(boq.approval).approvedBy,
            clientAcceptedBy: mergeApproval(boq.approval).clientAcceptedBy,
          },
          revisedFrom: {
            status: boq.status,
            revision: boq.revision || 1,
            at: new Date().toISOString(),
            approval: mergeApproval(boq.approval),
            procurement: boq.procurement || DEFAULT_PROCUREMENT,
          },
          revisionHistory: [
            ...(boq.revisionHistory || []),
            {
              revision: boq.revision || 1,
              status: boq.status,
              at: new Date().toISOString(),
              sections: JSON.parse(JSON.stringify(boq.sections || [])),
              approval: mergeApproval(boq.approval),
            },
          ],
          auditTrail: appendAuditTrail(boq, {
            action: "revision_created",
            label: "Revision Created",
            actor: "System",
            details: `Revision ${Number(boq.revision || 1) + 1} opened from ${boq.status}.`,
          }),
        });
        showToast(`Revision ${Number(boq.revision || 1) + 1} created`, "success");
      },
    });
  };

  const handleDuplicate = () => {
    const next = duplicateBoq(boq.id);
    if (next) {
      navigate(`/boq/${next.id}`);
      showToast(`Duplicated as ${next.id}`, "success");
    }
  };

  const handleDelete = () => {
    setConfirmDialog({
      title: "Delete this BOQ?",
      message: `${boq.id} will be permanently removed. This cannot be undone.`,
      confirmLabel: "Delete BOQ",
      danger: true,
      onConfirm: () => {
        deleteBoq(boq.id);
        navigate("/boq");
      },
    });
  };

  const seedFromPreset = (presetKey) => {
    if (!canEditBoq()) {
      showLockedToast();
      return;
    }
    const next = createBoq({
      title: boq.title,
      client: boq.client,
      project: boq.project,
      basedOnPreset: presetKey,
    });
    // Keep the same ID so we don't orphan storage
    saveBoq({ ...next, id: boq.id, createdAt: boq.createdAt });
    setBoq({ ...next, id: boq.id, createdAt: boq.createdAt });
    setShowSeedPicker(false);
    showToast(`Loaded ${presetKey} preset`, "success");
  };

  // Keyboard shortcut: Cmd/Ctrl + S to save, Esc to close dialogs/preview.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (boq) handleSave();
      }
      if (e.key === "Escape") {
        setConfirmDialog(null);
        setSendValidation(null);
        setShowPreview(false);
        setLibraryPickerSection(null);
        setShowSeedPicker(false);
        setShowHeaderMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boq]);

  const totals = useMemo(() => (boq ? computeBoqTotals(boq) : null), [boq]);
  const gst = useMemo(
    () => (boq ? resolveGstTreatment(boq) : null),
    [boq],
  );
  const itemCount = useMemo(
    () =>
      (boq?.sections || []).reduce((s, sec) => s + (sec.items?.length || 0), 0),
    [boq],
  );

  const roomGroups = useMemo(() => {
    const groups = [];
    const map = {};
    for (const sec of boq?.sections || []) {
      const key = sec.category || sec.name || "Uncategorized";
      if (!map[key]) {
        map[key] = { label: key, items: [] };
        groups.push(map[key]);
      }
      for (const item of sec.items || []) {
        map[key].items.push({ ...item, _from: sec.name });
      }
    }
    return groups;
  }, [boq]);

  const workGroups = useMemo(() => {
    const groups = [];
    const map = {};
    for (const sec of boq?.sections || []) {
      for (const item of sec.items || []) {
        const key = item.description || "Uncategorized";
        if (!map[key]) {
          map[key] = { label: key, items: [] };
          groups.push(map[key]);
        }
        map[key].items.push({ ...item, _from: sec.category || sec.name });
      }
    }
    return groups;
  }, [boq]);

  if (!boq) {
    return <div className="p-8 text-text-muted text-sm">Loading BOQ…</div>;
  }

  const status = STATUS_STYLES[boq.status] || STATUS_STYLES.draft;
  const isLocked = isLockedStatus(boq.status);
  const approval = mergeApproval(boq.approval);
  const isSignoffLocked = isSignoffLockedStatus(boq.status);

  return (
    <div className="bg-overallbg font-sans h-full overflow-hidden flex flex-col">
      {/* ── Sticky header ───────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-overallbg/80 backdrop-blur-xl border-b border-bordergray/70 shrink-0">
        <div className="px-6 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate("/boq")}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-bordergray bg-white text-text-muted hover:text-textcolor hover:bg-bg-soft"
              title="Back to list"
            >
              <ArrowLeft size={15} />
            </button>
            <div className="h-10 w-10 rounded-xl bg-linear-to-br from-select-blue to-primary text-white flex items-center justify-center shadow-md shadow-select-blue/20">
              <FileText size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold tracking-widest uppercase text-select-blue bg-select-blue/10 px-1.5 py-0.5 rounded-md border border-select-blue/20">
                  {boq.id}
                </span>
                <span
                  className={`text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 rounded-md border ${status.bg} ${status.text} ${status.border}`}
                >
                  {boq.status.replace(/_/g, " ")}
                </span>
                <span className="text-[10px] text-text-subtle">
                  Rev {boq.revision}
                </span>
              </div>
              <input
                type="text"
                value={boq.title}
                onChange={(e) => update({ title: e.target.value })}
                disabled={isLocked}
                placeholder="Untitled BOQ"
                className="text-[16px] font-bold text-textcolor bg-transparent border-0 focus:outline-none focus:ring-0 px-0 py-0 mt-0.5 min-w-[200px] hover:bg-white/40 rounded transition-colors disabled:hover:bg-transparent disabled:cursor-default"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => setShowMeasurementSheet(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-bordergray rounded-lg text-[11.5px] font-semibold text-textcolor hover:bg-bg-soft"
              title="View measurement sheet"
            >
              <Ruler size={12} /> Measurement Sheet
            </button>
            <button
              type="button"
              onClick={() => setShowMaterialSheet(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-bordergray rounded-lg text-[11.5px] font-semibold text-textcolor hover:bg-bg-soft"
              title="View BOQ material sheet"
            >
              <Package size={12} /> Material Sheet
            </button>
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-bordergray rounded-lg text-[11.5px] font-semibold text-textcolor hover:bg-bg-soft"
              title="Preview client-ready document & print / save as PDF"
            >
              <FileText size={12} /> Preview / Print
            </button>
            {boq.status === "draft" && (
              <button
                type="button"
                onClick={handleSend}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-500 text-white rounded-lg text-[11.5px] font-semibold hover:bg-blue-600 transition-all shadow-sm"
              >
                <Send size={12} /> Mark Sent
              </button>
            )}
            {boq.status === "sent" && (
              <button
                type="button"
                onClick={handleApprove}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 text-white rounded-lg text-[11.5px] font-semibold hover:bg-emerald-600 transition-all shadow-sm"
              >
                <CheckCircle2 size={12} /> Mark Approved
              </button>
            )}
            {boq.status === "approved" && (
              <>
                <button
                  type="button"
                  onClick={handleIssueForTender}
                  className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white rounded-lg text-[11.5px] font-semibold hover:bg-amber-600 transition-all shadow-sm"
                >
                  <Send size={12} /> Issue for Tender
                </button>
                <button
                  type="button"
                  onClick={handleSign}
                  className="flex items-center gap-1.5 px-3 py-2 bg-purple-500 text-white rounded-lg text-[11.5px] font-semibold hover:bg-purple-600 transition-all shadow-sm"
                >
                  <ShieldCheck size={12} /> Mark Signed
                </button>
              </>
            )}
            {boq.status === "issued_for_tender" && (
              <button
                type="button"
                onClick={handleSign}
                className="flex items-center gap-1.5 px-3 py-2 bg-purple-500 text-white rounded-lg text-[11.5px] font-semibold hover:bg-purple-600 transition-all shadow-sm"
              >
                <ShieldCheck size={12} /> Mark Signed
              </button>
            )}
            {boq.status === "signed" && (
              <button
                type="button"
                onClick={handleIssueForProcurement}
                className="flex items-center gap-1.5 px-3 py-2 bg-indigo-500 text-white rounded-lg text-[11.5px] font-semibold hover:bg-indigo-600 transition-all shadow-sm"
              >
                <PackageCheck size={12} /> Issue Procurement
              </button>
            )}
            {isLocked && (
              <button
                type="button"
                onClick={handleCreateRevision}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white rounded-lg text-[11.5px] font-semibold hover:bg-amber-600 transition-all shadow-sm"
              >
                <RotateCcw size={12} /> Create Revision
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={isLocked}
              className={`flex items-center gap-1.5 px-3 py-2 cursor-pointer rounded-lg text-[11.5px] font-semibold transition-all shadow-md ${
                isLocked
                  ? "bg-slate-200 text-slate-500 cursor-not-allowed shadow-none"
                  : savedFlash
                  ? "bg-emerald-500 text-white"
                  : "bg-linear-to-br from-select-blue to-primary text-white hover:scale-[1.02]"
              }`}
            >
              {savedFlash ? <Check size={12} /> : <Save size={12} />}
              {savedFlash ? "Saved" : "Save"}
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowHeaderMenu((p) => !p)}
                className="h-9 w-9 flex items-center justify-center rounded-lg bg-white border border-bordergray text-text-muted hover:bg-bg-soft hover:text-textcolor transition-all"
                title="More BOQ actions"
              >
                <MoreVertical size={15} />
              </button>
              {showHeaderMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowHeaderMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-xl border border-bordergray bg-white shadow-2xl z-50">
                    <button
                      type="button"
                      onClick={() => {
                        setShowHeaderMenu(false);
                        setShowSeedPicker(true);
                      }}
                      disabled={isLocked}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold text-text-muted hover:bg-bg-soft hover:text-textcolor disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Sparkles size={13} /> Seed from Preset
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowHeaderMenu(false);
                        handleDuplicate();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold text-text-muted hover:bg-bg-soft hover:text-textcolor"
                    >
                      <Copy size={13} /> Duplicate BOQ
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowHeaderMenu(false);
                        handleDelete();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12px] font-semibold text-red-500 hover:bg-red-50"
                    >
                      <Trash2 size={13} /> Delete BOQ
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {isLocked && (
          <div className="px-6 pb-3">
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              <div className="flex items-start gap-2">
                <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                <p className="text-[11.5px] leading-relaxed">
                  This BOQ is issued as <b>{boq.status}</b>. It is read-only to
                  protect the controlled version. Create a revision to make
                  changes.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="px-6 pb-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
            <span className="rounded-lg border border-bordergray bg-white px-2 py-1">
              {boq.sections.length} sections
            </span>
            <span className="rounded-lg border border-bordergray bg-white px-2 py-1">
              {itemCount} line items
            </span>
            <span className="rounded-lg border border-bordergray bg-white px-2 py-1">
              Rev {boq.revision}
            </span>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 flex-1 min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col scroll-hidden-bar">
        {boq.surveyStale && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              The linked site survey was unlocked after this BOQ was generated.
              Treat these quantities as stale until the survey is frozen and the
              BOQ is regenerated.
            </span>
          </div>
        )}
        {boq.siteID && Number.isFinite(Number(boq.quotedTotal)) && (
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-select-blue/20 bg-select-blue/[0.03] p-3 md:grid-cols-4">
            <CommercialValue
              label="Proposal quoted"
              value={boq.quotedTotal}
              tone="text-select-blue"
            />
            <CommercialValue
              label="Frozen measured"
              value={boq.measuredTotal}
              tone="text-textcolor"
            />
            <CommercialValue
              label="Current BOQ"
              value={totals.grandTotal}
              tone="text-purple-700"
            />
            <CommercialValue
              label="Survey difference"
              value={boq.surveyVariance}
              signed
              tone={
                Number(boq.surveyVariance) > Number(boq.surveyToleranceAmount || 15000)
                  ? "text-red-600"
                  : "text-emerald-700"
              }
            />
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5 lg:flex-1 lg:min-h-0 lg:overflow-hidden">
          {/* ── Left: Sections + line items ─────────────────────────────── */}
          <main className="space-y-5 min-w-0 lg:overflow-y-auto lg:pr-2 lg:pb-6 scroll-hidden-bar">
            {/* Client & Project meta */}
            <section className="bg-white rounded-2xl border border-bordergray shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
              <div className="px-5 py-3 border-b border-bordergray flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <User size={13} className="text-select-blue" />
                  <h3 className="text-[12px] font-bold text-textcolor">
                    Client & Project
                  </h3>
                  {boq.client?.id && (
                    <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Linked · {boq.client.id}
                    </span>
                  )}
                </div>
                <ClientPicker
                  current={boq.client}
                  disabled={isLocked}
                  onPick={(c) => {
                    const mapped = clientToBoqFields(c);
                    update({
                      client: { ...boq.client, ...mapped.client },
                      project: { ...boq.project, ...mapped.project },
                    });
                    showToast(`Linked to ${c.clientName}`, "success");
                  }}
                  onClear={() => {
                    update({ client: {}, project: {} });
                    showToast("Client link cleared", "info");
                  }}
                />
              </div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Field icon={<User size={11} />} label="Client Name">
                  <input
                    type="text"
                    value={boq.client?.name || ""}
                    onChange={(e) => updateClient({ name: e.target.value })}
                    disabled={isLocked}
                    placeholder="Mr / Ms…"
                    className={`${inputBase} disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                  />
                </Field>
                <Field icon={<Hash size={11} />} label="GSTIN">
                  <input
                    type="text"
                    value={boq.client?.gstin || ""}
                    onChange={(e) => updateClient({ gstin: e.target.value })}
                    disabled={isLocked}
                    placeholder="22AAAAA0000A1Z5"
                    className={`${inputBase} disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                  />
                </Field>
                <Field
                  icon={<Building2 size={11} />}
                  label="Client State"
                  hint="Used for GST place of supply when there's no GSTIN"
                >
                  <input
                    type="text"
                    value={boq.client?.state || ""}
                    onChange={(e) => updateClient({ state: e.target.value })}
                    disabled={isLocked}
                    placeholder="e.g. Tamil Nadu"
                    className={`${inputBase} disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                  />
                </Field>
                <Field
                  icon={<Building2 size={11} />}
                  label="Project / Property"
                >
                  <input
                    type="text"
                    value={boq.project?.name || ""}
                    onChange={(e) => updateProject({ name: e.target.value })}
                    disabled={isLocked}
                    placeholder="e.g. Sharma Residence"
                    className={`${inputBase} disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                  />
                </Field>
                <Field icon={<Calendar size={11} />} label="Validity">
                  <input
                    type="text"
                    value={boq.validity || ""}
                    onChange={(e) => update({ validity: e.target.value })}
                    disabled={isLocked}
                    placeholder="30 days from issue"
                    className={`${inputBase} disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                  />
                </Field>
                <Field icon={<ShieldCheck size={11} />} label="Warranty / Defect Liability">
                  <input
                    type="text"
                    value={boq.warrantyText || ""}
                    onChange={(e) => update({ warrantyText: e.target.value })}
                    disabled={isLocked}
                    placeholder="e.g. 12 months on hardware, 60 days defect liability"
                    className={`${inputBase} disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                  />
                </Field>
                {(boq.client?.phone ||
                  boq.client?.email ||
                  boq.project?.address) && (
                  <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted bg-bg-soft/60 border border-bordergray rounded-lg px-3 py-2">
                    {boq.client?.phone && <span>📞 {boq.client.phone}</span>}
                    {boq.client?.email && <span>✉️ {boq.client.email}</span>}
                    {boq.project?.address && (
                      <span>📍 {boq.project.address}</span>
                    )}
                    {boq.project?.propertyType && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-select-blue bg-white px-1.5 py-0.5 rounded border border-bordergray">
                        {boq.project.propertyType}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Sections */}
            <section className="space-y-4">
              {boq.sections.length === 0 && (
                <EmptySectionsState
                  onAdd={isLocked ? handleCreateRevision : addSection}
                  onAddFromTemplate={
                    isLocked ? handleCreateRevision : () => setShowSectionPicker(true)
                  }
                  onSeed={isLocked ? handleCreateRevision : () => setShowSeedPicker(true)}
                />
              )}

              {/* Find-in-BOQ search */}
              {boq.sections.length > 0 && (
                <div className="bg-white rounded-2xl border border-bordergray shadow-[0_1px_3px_rgba(15,23,42,0.04)] px-3 py-2 flex items-center gap-2">
                  <Search
                    size={13}
                    className="text-text-subtle shrink-0 ml-1"
                  />
                  <input
                    type="text"
                    value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)}
                    placeholder="Find in BOQ — search section, item description, HSN, material…"
                    className="flex-1 bg-transparent border-0 text-[12px] text-textcolor placeholder:text-text-subtle focus:outline-none focus:ring-0 px-1 py-1"
                  />
                  {itemSearch && (
                    <>
                      <span className="text-[10px] font-semibold text-text-muted bg-bg-soft px-2 py-0.5 rounded-md">
                        {(() => {
                          const q = itemSearch.toLowerCase();
                          const matchCount = boq.sections.reduce(
                            (s, sec) =>
                              s +
                              (sec.items || []).filter(
                                (it) =>
                                  (it.description || "")
                                    .toLowerCase()
                                    .includes(q) ||
                                  (it.hsn || "").toLowerCase().includes(q) ||
                                  (it.materials || []).some(
                                    (m) =>
                                      (m.name || "")
                                        .toLowerCase()
                                        .includes(q) ||
                                      (m.spec || "").toLowerCase().includes(q),
                                  ),
                              ).length,
                            0,
                          );
                          return `${matchCount} match${matchCount === 1 ? "" : "es"}`;
                        })()}
                      </span>
                      <button
                        type="button"
                        onClick={() => setItemSearch("")}
                        className="h-6 w-6 flex items-center justify-center rounded-md text-text-subtle hover:text-textcolor hover:bg-bg-soft"
                        title="Clear search"
                      >
                        <X size={12} />
                      </button>
                    </>
                  )}
                  <span className="h-4 w-px bg-bordergray shrink-0 mx-1" />
                  <div className="flex items-center gap-0.5 bg-bg-soft rounded-md p-0.5 shrink-0">
                    {[
                      { mode: "section", label: "Section", icon: <Hash size={11} /> },
                      { mode: "room", label: "Room", icon: <Building2 size={11} /> },
                      { mode: "work", label: "Work", icon: <Layers size={11} /> },
                      { mode: "all", label: "All Items", icon: <List size={11} /> },
                    ].map(({ mode, label, icon }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setGroupMode(mode)}
                        title={`Group by ${label}`}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-semibold transition-all ${
                          groupMode === mode
                            ? "bg-white text-textcolor shadow-sm"
                            : "text-text-muted hover:text-textcolor"
                        }`}
                      >
                        {icon}
                        <span className="hidden sm:inline">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* All Items flat list — read-only */}
              {groupMode === "all" && boq.sections.length > 0 && (() => {
                const allItems = boq.sections.flatMap((sec, sIdx) =>
                  (sec.items || []).map((item, iIdx) => ({
                    item,
                    secLabel: sec.name || `Section ${sIdx + 1}`,
                    ref: `${sIdx + 1}.${iIdx + 1}`,
                  }))
                );
                const grandNet = allItems.reduce((s, { item }) => {
                  const a = computeItemAmount(item);
                  return s + a.net;
                }, 0);
                return (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200/70 rounded-xl text-[11px] text-amber-800">
                      <Info size={12} className="shrink-0" />
                      <span>
                        All Items view is read-only —{" "}
                        <button
                          type="button"
                          onClick={() => setGroupMode("section")}
                          className="font-bold underline underline-offset-2"
                        >
                          switch to Section view
                        </button>{" "}
                        to edit.
                      </span>
                    </div>
                    <div className="bg-white border border-bordergray rounded-xl overflow-hidden">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="bg-bg-soft/60 border-b border-bordergray text-[9px] font-bold uppercase tracking-wider text-text-subtle">
                            <th className="px-3 py-2 text-center w-16">#</th>
                            <th className="px-3 py-2 text-center w-32">Section</th>
                            <th className="px-3 py-2 text-center">Description</th>
                            <th className="px-3 py-2 text-center w-20">Qty</th>
                            <th className="px-3 py-2 text-center w-16">Unit</th>
                            <th className="px-3 py-2 text-center w-28">Rate (₹)</th>
                            <th className="px-3 py-2 text-center w-32">Amount (₹)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allItems.map(({ item, secLabel, ref }, i) => {
                            const amt = computeItemAmount(item);
                            const qty = computeItemQty(item);
                            return (
                              <tr
                                key={item.id || i}
                                className="border-t border-bordergray hover:bg-bg-soft/30"
                              >
                                <td className="px-3 py-2 text-center text-[10.5px] font-bold text-text-muted tabular-nums">
                                  {ref}
                                </td>
                                <td className="px-3 py-2 text-center text-[10.5px] text-text-muted">
                                  {secLabel}
                                </td>
                                <td className="px-3 py-2 text-textcolor">
                                  {item.description || (
                                    <span className="text-text-subtle italic">No description</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-center tabular-nums">
                                  {qty.toFixed(2).replace(/\.00$/, "")}
                                </td>
                                <td className="px-3 py-2 text-center text-text-muted">
                                  {item.unit || "—"}
                                </td>
                                <td className="px-3 py-2 text-center tabular-nums">
                                  {formatAmount(item.rate || 0)}
                                </td>
                                <td className="px-3 py-2 text-center tabular-nums font-semibold">
                                  {formatAmount(amt.net)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-bordergray bg-bg-soft/40">
                            <td
                              colSpan={6}
                              className="px-3 py-2 text-[10.5px] font-bold text-text-muted text-right"
                            >
                              Grand Total
                            </td>
                            <td className="px-3 py-2 text-center tabular-nums font-bold text-textcolor">
                              {formatAmount(grandNet)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </>
                );
              })()}

              {/* Room / Work grouped view — read-only */}
              {(groupMode === "room" || groupMode === "work") && boq.sections.length > 0 && (() => {
                const groups = groupMode === "room" ? roomGroups : workGroups;
                return (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200/70 rounded-xl text-[11px] text-amber-800">
                      <Info size={12} className="shrink-0" />
                      <span>
                        Grouped view is read-only —{" "}
                        <button
                          type="button"
                          onClick={() => setGroupMode("section")}
                          className="font-bold underline underline-offset-2"
                        >
                          switch to Section view
                        </button>{" "}
                        to edit.
                      </span>
                    </div>
                    {groups.map((group, gIdx) => {
                      const c = roomColor(group.label);
                      const groupTotal = group.items.reduce(
                        (s, it) => s + computeItemAmount(it).total,
                        0,
                      );
                      return (
                        <div
                          key={`${groupMode}_${gIdx}`}
                          className="bg-white rounded-2xl border border-bordergray shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden"
                        >
                          <div className="px-4 py-3 border-b border-bordergray flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`h-7 w-7 flex items-center justify-center rounded-lg ${c.bg}`}
                              >
                                <span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />
                              </span>
                              <span className="text-[13px] font-bold text-textcolor truncate">
                                {group.label || "Uncategorized"}
                              </span>
                              <span className="text-[10px] text-text-muted bg-bg-soft px-1.5 py-0.5 rounded border border-bordergray shrink-0">
                                {group.items.length} item{group.items.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                            <span className="text-[13px] font-bold text-textcolor tabular-nums shrink-0">
                              {formatAmount(groupTotal)}
                            </span>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[12px]">
                              <thead>
                                <tr className="bg-bg-soft/60 border-b border-bordergray text-[9px] font-bold uppercase tracking-wider text-text-subtle">
                                  <th className="px-3 py-2 text-center w-32">
                                    {groupMode === "room" ? "Section" : "Room / Area"}
                                  </th>
                                  <th className="px-3 py-2 text-center">Description</th>
                                  <th className="px-3 py-2 text-center w-20">Qty</th>
                                  <th className="px-3 py-2 text-center w-16">Unit</th>
                                  <th className="px-3 py-2 text-center w-24">Rate (₹)</th>
                                  <th className="px-3 py-2 text-center w-28">Amount (₹)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.items.map((item, iIdx) => {
                                  const amt = computeItemAmount(item);
                                  const qty = computeItemQty(item);
                                  return (
                                    <tr
                                      key={item.id || iIdx}
                                      className="border-t border-bordergray hover:bg-bg-soft/30"
                                    >
                                      <td className="px-3 py-2 text-center text-[10.5px] text-text-muted">
                                        {item._from || "—"}
                                      </td>
                                      <td className="px-3 py-2 text-textcolor">
                                        {item.description || (
                                          <span className="text-text-subtle italic">No description</span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-center tabular-nums">
                                        {qty.toFixed(2).replace(/\.00$/, "")}
                                      </td>
                                      <td className="px-3 py-2 text-center text-text-muted">{item.unit}</td>
                                      <td className="px-3 py-2 text-center tabular-nums">
                                        {formatAmount(item.rate || 0)}
                                      </td>
                                      <td className="px-3 py-2 text-center tabular-nums font-semibold">
                                        {formatAmount(amt.total)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot>
                                <tr className="border-t-2 border-bordergray bg-bg-soft/40">
                                  <td
                                    colSpan={5}
                                    className="px-3 py-2 text-[10.5px] font-bold text-text-muted text-center"
                                  >
                                    Subtotal
                                  </td>
                                  <td className="px-3 py-2 text-center tabular-nums font-bold text-textcolor">
                                    {formatAmount(groupTotal)}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </>
                );
              })()}

              {/* Section-wise view */}
              {groupMode === "section" && boq.sections.map((section, sIdx) => {
                const c = roomColor(section.category);
                const isOpen = expanded[section.id] !== false;
                const sectionTotal = (section.items || []).reduce(
                  (s, it) => s + computeItemAmount(it).total,
                  0,
                );

                // Apply item search filter
                const q = itemSearch.trim().toLowerCase();
                const itemMatchesSearch = (it) => {
                  if (!q) return true;
                  return (
                    (it.description || "").toLowerCase().includes(q) ||
                    (it.hsn || "").toLowerCase().includes(q) ||
                    (it.materials || []).some(
                      (m) =>
                        (m.name || "").toLowerCase().includes(q) ||
                        (m.spec || "").toLowerCase().includes(q),
                    )
                  );
                };
                const sectionMatchesName =
                  q && (section.name || "").toLowerCase().includes(q);
                const visibleItems = q
                  ? section.items.filter(itemMatchesSearch)
                  : section.items;
                // Hide the entire section if a search is active AND nothing inside matches
                if (q && visibleItems.length === 0 && !sectionMatchesName) {
                  return null;
                }
                return (
                  <div
                    key={section.id}
                    className="bg-white rounded-2xl border border-bordergray shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden"
                  >
                    {/* Section header */}
                    <div
                      className={`px-4 py-3 border-b border-bordergray flex items-center justify-between gap-3 bg-linear-to-r ${c.bg.replace("bg-", "from-")}/40 to-white`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((p) => ({
                              ...p,
                              [section.id]: !isOpen,
                            }))
                          }
                          className="h-7 w-7 flex items-center justify-center rounded-md text-text-muted hover:bg-white"
                          title={isOpen ? "Collapse" : "Expand"}
                        >
                          {isOpen ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </button>
                        <span className="text-[10px] font-bold text-text-muted bg-white px-1.5 py-0.5 rounded border border-bordergray tabular-nums">
                          {String(sIdx + 1).padStart(2, "0")}
                        </span>
                        <span
                          className={`h-7 w-7 flex items-center justify-center rounded-lg ${c.bg}`}
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${c.dot}`}
                          />
                        </span>
                        <input
                          type="text"
                          value={section.name}
                          onChange={(e) =>
                            updateSection(section.id, { name: e.target.value })
                          }
                          disabled={isLocked}
                          placeholder="Section name"
                          className="text-[13px] font-bold text-textcolor bg-transparent border-0 focus:outline-none focus:bg-white focus:rounded focus:px-2 focus:py-1 px-0 py-1 transition-all min-w-0 flex-1 disabled:cursor-default disabled:focus:bg-transparent"
                        />
                        <CategorySelect
                          value={section.category}
                          onChange={(v) =>
                            updateSection(section.id, { category: v })
                          }
                          disabled={isLocked}
                          placeholder="Room…"
                          className="text-[10.5px] font-semibold bg-white border border-bordergray rounded-md px-1.5 py-1 text-text-muted focus:outline-none focus:border-select-blue cursor-pointer"
                        />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="hidden sm:flex flex-col items-end">
                          <span className="text-[9.5px] font-bold uppercase tracking-wider text-text-subtle">
                            Section Total
                          </span>
                          <span className="text-[13px] font-bold text-textcolor tabular-nums">
                            {formatAmount(sectionTotal)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={
                            isLocked
                              ? handleCreateRevision
                              : () => duplicateSection(section.id)
                          }
                          className="h-7 w-7 flex items-center justify-center rounded-md text-text-muted hover:bg-white hover:text-textcolor"
                          title={
                            isLocked
                              ? "Create a revision to duplicate this section"
                              : "Duplicate section"
                          }
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={
                            isLocked
                              ? handleCreateRevision
                              : () => removeSection(section.id)
                          }
                          className="h-7 w-7 flex items-center justify-center rounded-md text-text-subtle hover:text-red-500 hover:bg-red-50"
                          title={
                            isLocked
                              ? "Create a revision to delete this section"
                              : "Delete section"
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Items table */}
                    {isOpen && (
                      <>
                        {visibleItems.length > 0 && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-[12px]">
                              <thead>
                                <tr className="bg-bg-soft/60 border-b border-bordergray text-[9px] font-bold uppercase tracking-wider text-text-subtle">
                                  <th className="px-2 py-2 text-center w-8">#</th>
                                  <th className="px-2 py-2 text-center w-[42%] min-w-[260px]">
                                    Description
                                  </th>
                                  <th className="px-2 py-2 text-center w-20">
                                    Qty
                                  </th>
                                  <th className="px-2 py-2 text-center w-20">
                                    Unit
                                  </th>
                                  <th className="px-2 py-2 text-center w-24">
                                    Rate (₹)
                                  </th>
                                  <th className="px-2 py-2 text-center w-28">
                                    Amount (₹)
                                  </th>
                                  <th className="px-2 py-2 w-24"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {visibleItems.map((item) => {
                                  const realIdx = section.items.findIndex(
                                    (i) => i.id === item.id,
                                  );
                                  const isLinked = !!item.masterId;
                                  const isCompact =
                                    isLinked && !expandedLinked[item.id];
                                  return (
                                    <ItemRow
                                      key={item.id}
                                      item={item}
                                      idx={realIdx}
                                      sectionId={section.id}
                                      onUpdate={(changes) =>
                                        updateItem(section.id, item.id, changes)
                                      }
                                      onRemove={() =>
                                        removeItem(section.id, item.id)
                                      }
                                      onDuplicate={() =>
                                        duplicateItem(section.id, item.id)
                                      }
                                      onEdit={() =>
                                        setEditingItem({
                                          sectionId: section.id,
                                          itemId: item.id,
                                        })
                                      }
                                      accent={c}
                                      isLinked={isLinked}
                                      isCompact={isCompact}
                                      onToggleCompact={() =>
                                        setExpandedLinked((p) => ({
                                          ...p,
                                          [item.id]: !p[item.id],
                                        }))
                                      }
                                      disabled={isLocked}
                                    />
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {q &&
                          visibleItems.length === 0 &&
                          sectionMatchesName && (
                            <div className="px-4 py-3 bg-bg-soft/30 text-[11px] text-text-muted border-t border-bordergray">
                              Section name matched "{itemSearch}" — no items in
                              this section matched.
                            </div>
                          )}

                        <div className="px-4 py-3 border-t border-bordergray bg-bg-soft/30 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={
                                isLocked
                                  ? handleCreateRevision
                                  : () => setItemFormSection(section.id)
                              }
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-select-blue hover:bg-white border border-transparent hover:border-bordergray transition-all"
                            >
                              <Plus size={12} /> Add Line Item
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                isLocked
                                  ? handleCreateRevision()
                                  : setLibraryPickerSection(section.id)
                              }
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-text-muted hover:text-select-blue hover:bg-white border border-bordergray transition-all"
                              title={
                                isLocked
                                  ? "Create a revision to insert from the library"
                                  : "Insert from Item Master library"
                              }
                            >
                              <BookOpen size={11} /> Insert from Library
                            </button>
                          </div>
                          {section.items.length === 0 && (
                            <span className="text-[10.5px] text-text-subtle">
                              Empty section — add your first item
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {groupMode === "section" && boq.sections.length > 0 && (
                <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={isLocked ? handleCreateRevision : addSection}
                      className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-2xl border border-dashed border-bordergray text-[12px] font-semibold text-text-muted hover:border-select-blue hover:text-select-blue hover:bg-active-bg/40 transition-all"
                    >
                      <Plus size={13} /> Blank Section
                    </button>
                  </div>
              )}
            </section>
          </main>

          {/* ── Right: Summary, terms, notes ────────────────────────────── */}
          <aside className="space-y-5 lg:overflow-y-auto lg:pr-1 lg:pb-6 scroll-hidden-bar">
            {/* Totals */}
            <section className="bg-white rounded-2xl border border-bordergray shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden">
              <div className="px-4 py-3 border-b border-bordergray flex items-center gap-2 bg-linear-to-r from-select-blue/5 to-white">
                <Wallet size={13} className="text-select-blue" />
                <h3 className="text-[12px] font-bold text-textcolor">
                  Summary
                </h3>
              </div>
              <div className="p-4 space-y-2 text-[11.5px]">
                <Row
                  label="Gross Subtotal"
                  value={formatAmount(totals.subtotal)}
                />
                {totals.lineDiscounts > 0 && (
                  <Row
                    label="Line discounts"
                    value={`- ${formatAmount(totals.lineDiscounts)}`}
                    accent="text-red-500"
                  />
                )}
                <Row
                  label="Taxable amount"
                  value={formatAmount(totals.taxable)}
                />

                {/* BOQ-level discount */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-text-muted flex items-center gap-1">
                    <Percent size={11} /> BOQ Discount
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={boq.discount?.value || 0}
                      onChange={(e) =>
                        update({
                          discount: {
                            ...boq.discount,
                            value: Number(e.target.value) || 0,
                          },
                        })
                      }
                      disabled={isLocked}
                      className="w-16 text-right tabular-nums bg-bg-soft border border-bordergray rounded px-1.5 py-1 text-[11px] focus:outline-none focus:border-select-blue"
                    />
                    <select
                      value={boq.discount?.type || "percent"}
                      onChange={(e) =>
                        update({
                          discount: {
                            ...boq.discount,
                            type: e.target.value,
                          },
                        })
                      }
                      disabled={isLocked}
                      className="bg-bg-soft border border-bordergray rounded px-1 py-1 text-[10.5px] font-semibold text-text-muted cursor-pointer"
                    >
                      <option value="percent">%</option>
                      <option value="flat">₹</option>
                    </select>
                  </div>
                </div>
                {totals.boqDiscountAmt > 0 && (
                  <Row
                    label="Discount value"
                    value={`- ${formatAmount(totals.boqDiscountAmt)}`}
                    accent="text-red-500"
                  />
                )}

                <Row
                  label="After Discount"
                  value={formatAmount(totals.afterBoqDiscount)}
                />

                {/* Contingency is BOQ-level; labour is included in Item Master rates. */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-text-muted flex items-center gap-1">
                    <Percent size={11} /> Contingency
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={boq.contingencyPercent || 0}
                      onChange={(e) =>
                        update({ contingencyPercent: Number(e.target.value) || 0 })
                      }
                      disabled={isLocked}
                      className="w-16 text-right tabular-nums bg-bg-soft border border-bordergray rounded px-1.5 py-1 text-[11px] focus:outline-none focus:border-select-blue"
                    />
                    <span className="text-[10.5px] font-semibold text-text-muted">%</span>
                  </div>
                </div>
                {totals.contingencyAmt > 0 && (
                  <Row label="Contingency value" value={formatAmount(totals.contingencyAmt)} />
                )}
                {totals.contingencyAmt > 0 && (
                  <Row
                    label="Taxable (incl. contingency)"
                    value={formatAmount(totals.baseForGst)}
                  />
                )}

                <div className="border-t border-bordergray pt-2 space-y-1">
                  {Object.entries(totals.gstByRate || {})
                    .filter(([, v]) => v > 0)
                    .map(([rate, v]) =>
                      gst.interState ? (
                        <Row
                          key={rate}
                          label={`IGST @ ${rate}%`}
                          value={formatAmount(v)}
                          accent="text-orange-500"
                        />
                      ) : (
                        <div key={rate}>
                          <Row
                            label={`CGST @ ${Number(rate) / 2}%`}
                            value={formatAmount(v / 2)}
                            accent="text-orange-500"
                          />
                          <Row
                            label={`SGST @ ${Number(rate) / 2}%`}
                            value={formatAmount(v / 2)}
                            accent="text-orange-500"
                          />
                        </div>
                      ),
                    )}
                  {totals.totalGst > 0 && (
                    <Row
                      label="Total GST"
                      value={formatAmount(totals.totalGst)}
                      accent="text-orange-500 font-bold"
                    />
                  )}
                  {totals.totalGst > 0 && gst.assumed && (
                    <p className="flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-1">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      GST treatment assumed — confirm the client's state for
                      accurate IGST vs CGST+SGST.
                    </p>
                  )}
                </div>

                <div className="mt-3 -mx-4 -mb-4 px-4 py-3 bg-linear-to-br from-select-blue to-primary text-white">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] font-bold uppercase tracking-wider opacity-80">
                      Grand Total
                    </span>
                    <span className="text-[18px] font-bold tabular-nums">
                      {formatAmount(totals.grandTotal)}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Payment milestones */}
            <CollapsiblePanel
              title="Payment Milestones"
              icon={<Calendar size={13} className="text-select-blue" />}
              meta="5-stage standard"
              actions={
                <>
                  <button
                    type="button"
                    onClick={() =>
                      update({
                        paymentTerms: PAYMENT_MILESTONES.map((m) => ({
                          id: m.id,
                          label: m.name,
                          percent: m.pct,
                        })),
                      })
                    }
                    disabled={isLocked}
                    className="flex items-center gap-1 text-[11px] font-semibold text-text-muted hover:text-select-blue"
                    title="Reset to standard 5-stage milestone schedule"
                  >
                    <RotateCcw size={11} /> Reset
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      update({
                        paymentTerms: [
                          ...(boq.paymentTerms || []),
                          { label: "", percent: 0 },
                        ],
                      })
                    }
                    disabled={isLocked}
                    className="flex items-center gap-1 text-[11px] font-semibold text-select-blue hover:text-primary"
                  >
                    <Plus size={11} /> Add
                  </button>
                </>
              }
            >
              <div className="p-3 space-y-2">
                {(boq.paymentTerms || []).map((m, idx) => {
                  const amt =
                    (totals.grandTotal * (Number(m.percent) || 0)) / 100;
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-[1fr_60px_24px] gap-2 items-center"
                    >
                      <input
                        type="text"
                        value={m.label}
                        onChange={(e) =>
                          update({
                            paymentTerms: boq.paymentTerms.map((p, i) =>
                              i === idx ? { ...p, label: e.target.value } : p,
                            ),
                          })
                        }
                        disabled={isLocked}
                        placeholder="On signing"
                        className={compactInput}
                      />
                      <div className="relative">
                        <input
                          type="number"
                          value={m.percent}
                          onChange={(e) =>
                            update({
                              paymentTerms: boq.paymentTerms.map((p, i) =>
                                i === idx
                                  ? {
                                      ...p,
                                      percent: Number(e.target.value) || 0,
                                    }
                                  : p,
                              ),
                          })
                        }
                          disabled={isLocked}
                          className={`${compactInput} text-right pr-5`}
                        />
                        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-text-subtle">
                          %
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          update({
                            paymentTerms: boq.paymentTerms.filter(
                              (_, i) => i !== idx,
                            ),
                          })
                        }
                        disabled={isLocked}
                        className="h-7 w-6 flex items-center justify-center rounded-md text-text-subtle hover:text-red-500 hover:bg-red-50"
                      >
                        <Trash2 size={11} />
                      </button>
                      <p className="col-span-3 text-[9.5px] text-text-subtle tabular-nums -mt-1">
                        ≈ {formatAmount(Math.round(amt))}
                      </p>
                    </div>
                  );
                })}
                {(boq.paymentTerms || []).length > 0 && (
                  <div className="pt-1 border-t border-bordergray flex justify-between text-[10.5px]">
                    <span className="text-text-muted">Total %</span>
                    <span
                      className={`font-bold tabular-nums ${
                        boq.paymentTerms.reduce(
                          (s, m) => s + (Number(m.percent) || 0),
                          0,
                        ) === 100
                          ? "text-emerald-600"
                          : "text-orange-500"
                      }`}
                    >
                      {boq.paymentTerms.reduce(
                        (s, m) => s + (Number(m.percent) || 0),
                        0,
                      )}
                      %
                    </span>
                  </div>
                )}
              </div>
            </CollapsiblePanel>

            {/* Notes */}
            <CollapsiblePanel
              title="Notes / Terms"
              icon={<StickyNote size={13} className="text-select-blue" />}
            >
              <div className="p-3">
                <textarea
                  value={boq.notes || ""}
                  onChange={(e) => update({ notes: e.target.value })}
                  disabled={isLocked}
                  rows={5}
                  placeholder="Special terms, exclusions, site conditions, etc."
                  className={`${compactInput} resize-none leading-relaxed`}
                />
              </div>
            </CollapsiblePanel>

            <CollapsiblePanel
              title="Approval Signoff"
              icon={<ShieldCheck size={13} className="text-select-blue" />}
              meta={boq.status === "draft" ? "before issue" : boq.status}
              defaultOpen={boq.status !== "draft"}
            >
              <div className="p-3 space-y-3">
                {isSignoffLocked && (
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10.5px] font-semibold text-emerald-700">
                    Signed approval metadata is locked for this revision.
                  </p>
                )}
                {boq.procurement?.issued && (
                  <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[10.5px] font-semibold text-indigo-700">
                    Issued for procurement by{" "}
                    {boq.procurement.issuedBy || "Authorized user"} on{" "}
                    {formatSignoffDate(boq.procurement.issuedAt)}
                    {boq.procurement.contractId
                      ? ` · Contract ${boq.procurement.contractId}`
                      : ""}.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2">
                  <SignoffField
                    label="Prepared by"
                    value={approval.preparedBy}
                    date={approval.preparedAt}
                    disabled={isSignoffLocked}
                    onChange={(value) => updateApproval({ preparedBy: value })}
                  />
                  <SignoffField
                    label="Reviewed by"
                    value={approval.reviewedBy}
                    date={approval.reviewedAt}
                    disabled={isSignoffLocked}
                    onChange={(value) => updateApproval({ reviewedBy: value })}
                  />
                  <SignoffField
                    label="Approved by"
                    value={approval.approvedBy}
                    date={approval.approvedAt}
                    disabled={isSignoffLocked}
                    onChange={(value) => updateApproval({ approvedBy: value })}
                  />
                  <SignoffField
                    label="Client acceptance"
                    value={approval.clientAcceptedBy}
                    date={approval.clientAcceptedAt}
                    disabled={isSignoffLocked}
                    onChange={(value) =>
                      updateApproval({ clientAcceptedBy: value })
                    }
                  />
                </div>

                <div className="rounded-xl border border-bordergray bg-bg-soft/40 p-2.5">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    Review checklist
                  </p>
                  <div className="grid grid-cols-1 gap-1.5">
                    <SignoffCheck
                      label="Measurements checked"
                      checked={approval.checklist.measurementsChecked}
                      disabled={isSignoffLocked}
                      onChange={(checked) =>
                        updateApprovalChecklist("measurementsChecked", checked)
                      }
                    />
                    <SignoffCheck
                      label="Rates and quantities checked"
                      checked={approval.checklist.ratesChecked}
                      disabled={isSignoffLocked}
                      onChange={(checked) =>
                        updateApprovalChecklist("ratesChecked", checked)
                      }
                    />
                    <SignoffCheck
                      label="GST and tax summary checked"
                      checked={approval.checklist.taxChecked}
                      disabled={isSignoffLocked}
                      onChange={(checked) =>
                        updateApprovalChecklist("taxChecked", checked)
                      }
                    />
                    <SignoffCheck
                      label="Terms and exclusions checked"
                      checked={approval.checklist.termsChecked}
                      disabled={isSignoffLocked}
                      onChange={(checked) =>
                        updateApprovalChecklist("termsChecked", checked)
                      }
                    />
                  </div>
                </div>

                <textarea
                  value={approval.remarks}
                  onChange={(e) => updateApproval({ remarks: e.target.value })}
                  onFocus={() => {
                    if (isSignoffLocked) showSignoffLockedToast();
                  }}
                  disabled={isSignoffLocked}
                  rows={3}
                  placeholder="Internal approval remarks"
                  className={`${compactInput} resize-none leading-relaxed disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                />
                <AuditTrailList
                  items={boq.auditTrail || []}
                  revisionHistory={boq.revisionHistory || []}
                  onViewSnapshot={setViewingSnapshot}
                />
              </div>
            </CollapsiblePanel>

            {/*  Included */}
            <BulletListEditor
              title="Included"
              icon={<CheckCircle2 size={13} className="text-emerald-600" />}
              accent="emerald"
              items={boq.inclusions || []}
              placeholder="e.g. 3D visualization of all rooms"
              onChange={(next) => update({ inclusions: next })}
              disabled={isLocked}
            />

            {/* Not Included */}
            <BulletListEditor
              title="Not Included"
              icon={<X size={13} className="text-red-500" />}
              accent="red"
              items={boq.exclusions || []}
              placeholder="e.g. Civil work — demolition, plumbing"
              onChange={(next) => update({ exclusions: next })}
              disabled={isLocked}
            />
          </aside>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <Toast key={toast.id} toast={toast} onClose={() => setToast(null)} />
      )}

      {/* Confirm dialog */}
      {confirmDialog && (
        <ConfirmDialog
          {...confirmDialog}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={() => {
            confirmDialog.onConfirm?.();
            setConfirmDialog(null);
          }}
        />
      )}

      {/* Send validation — blocks (must fix) or warnings (can override) */}
      {sendValidation && (
        <SendValidationDialog
          blocks={sendValidation.blocks}
          warnings={sendValidation.warnings}
          onCancel={() => setSendValidation(null)}
          onSendAnyway={finalizeSend}
        />
      )}

      {/* Seed picker modal */}
      {showSeedPicker && (
        <SeedPicker
          onClose={() => setShowSeedPicker(false)}
          onPick={seedFromPreset}
        />
      )}

      {/* Item Master picker modal */}
      {libraryPickerSection && (
        <LibraryPicker
          onClose={() => setLibraryPickerSection(null)}
          onInsert={(items) => {
            insertLibraryItems(libraryPickerSection, items);
            setLibraryPickerSection(null);
          }}
        />
      )}

      {/* Section template picker */}
      {showSectionPicker && (
        <SectionTemplatePicker
          onClose={() => setShowSectionPicker(false)}
          onAddBlank={() => {
            setShowSectionPicker(false);
            addSection();
          }}
          onAddFromCategory={addSectionFromCategory}
        />
      )}

      {/* Measurement sheet overlay */}
      {showMeasurementSheet && (
        <MeasurementSheetPreview
          boq={boq}
          onClose={() => setShowMeasurementSheet(false)}
        />
      )}

      {/* Material sheet overlay */}
      {showMaterialSheet && (
        <MaterialSheetPreview
          boq={boq}
          onClose={() => setShowMaterialSheet(false)}
        />
      )}

      {/* Revision snapshot viewer */}
      {viewingSnapshot && (
        <RevisionSnapshotModal
          snapshot={viewingSnapshot}
          onClose={() => setViewingSnapshot(null)}
        />
      )}

      {/* Print preview overlay */}
      {showPreview && (
        <BOQPreview boq={boq} onClose={() => setShowPreview(false)} />
      )}

      {/* Full Item Form modal — opened by "Add Line Item" in any section */}
      {itemFormSection && (
        <ItemFormModal
          initial={{}}
          onSave={handleItemFormSave}
          onClose={() => setItemFormSection(null)}
          title="Add Line Item"
          submitLabel="Add to Section"
          showCategory={false}
          showTags={false}
        />
      )}

      {/* Edit existing line item in the same full form */}
      {editingItem &&
        (() => {
          const sec = boq.sections.find((s) => s.id === editingItem.sectionId);
          const it = sec?.items.find((i) => i.id === editingItem.itemId);
          if (!it) return null;
          return (
            <ItemFormModal
              initial={boqItemToForm(it)}
              onSave={handleItemEditSave}
              onClose={() => setEditingItem(null)}
              title="Edit Line Item"
              submitLabel="Save Changes"
              showCategory={false}
              showTags={false}
            />
          );
        })()}
    </div>
  );
};

// ─── Item row ───────────────────────────────────────────────────────────────
const ItemRow = ({
  item,
  idx,
  onUpdate,
  onRemove,
  onDuplicate,
  onEdit,
  isLinked,
  isCompact,
  onToggleCompact,
  disabled = false,
}) => {
  const r = computeItemAmount(item);
  const computedQty = computeItemQty(item);
  const hasSurveyDrift =
    item.siteSurveySource &&
    Math.abs(computedQty - (Number(item.siteMeasuredQty) || 0)) > 0.001;
  const dimInfo = DIMENSIONAL_UNITS[item.unit];
  const dimsEnabled = item.dimensions?.enabled;
  const canUseDims = !!dimInfo;
  const isArea = dimInfo?.kind === "area";
  const hasDimValues =
    canUseDims &&
    (Number(item.dimensions?.length) > 0 ||
      Number(item.dimensions?.breadth) > 0 ||
      Number(item.dimensions?.height) > 0);
  const showDims = canUseDims && (dimsEnabled || hasDimValues);
  const unitLabel = UNITS.find((u) => u.code === item.unit)?.label || item.unit;
  const [detailsOpen, setDetailsOpen] = useState(
    () =>
      isLinked ||
      !!item.spec ||
      !!item.hsn ||
      (item.materials || []).length > 0,
  );

  const updateDim = (changes) =>
    onUpdate({ dimensions: { ...(item.dimensions || {}), ...changes } });

  const badges = (
    <div className="flex flex-wrap items-center gap-1">
      {isLinked && (
        <button
          type="button"
          onClick={onToggleCompact}
          disabled={disabled}
          className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider bg-select-blue/10 text-select-blue px-1.5 py-0.5 rounded border border-select-blue/20 hover:bg-select-blue/20 disabled:cursor-not-allowed"
          title="Show item details"
        >
          <Link2 size={9} /> Library
        </button>
      )}
      {item.siteSurveySource && (
        <span
          className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold ${
            hasSurveyDrift
              ? "border border-amber-200 bg-amber-50 text-amber-700"
              : "border border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
          title={
            hasSurveyDrift
              ? `Editor quantity differs from site measurement (${item.siteMeasuredQty})`
              : "Quantity matches the frozen site survey"
          }
        >
          {hasSurveyDrift ? <AlertTriangle size={9} /> : <ShieldCheck size={9} />}
          {hasSurveyDrift ? "Survey drift" : "Site measured"}
        </span>
      )}
      {item.isVariation && (
        <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
          <AlertTriangle size={9} /> Variation
        </span>
      )}
    </div>
  );

  const summaryLine = (
    <p className="mt-1 text-[10.5px] text-text-muted">
      HSN <span className="font-semibold text-textcolor">{item.hsn || "-"}</span>
      {(item.materials || []).length > 0 && (
        <>
          {" | "}
          <span className="font-semibold text-textcolor">
            {(item.materials || []).length} material
            {(item.materials || []).length === 1 ? "" : "s"}
          </span>
        </>
      )}
    </p>
  );

  const compactMainRow = (
    <tr className="border-b border-bordergray bg-select-blue/[0.03] hover:bg-active-bg/20">
      <td className="px-2 py-2 align-top text-center">
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            className="text-text-subtle cursor-grab"
            title="Drag (coming soon)"
          >
            <GripVertical size={11} />
          </button>
          <span className="text-[10.5px] font-bold text-text-muted tabular-nums">
            {String(idx + 1).padStart(2, "0")}
          </span>
        </div>
      </td>
      <td className="px-2 py-2 align-top w-[42%] min-w-[260px]">
        <div className="space-y-1">
          <textarea
            value={item.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            disabled={disabled}
            placeholder="Item description"
            className={`${compactInput} font-medium resize-none disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
            rows={2}
          />
          {badges}
        </div>
        {summaryLine}
        {item.siteSurveySource && (
          <p className="mt-0.5 text-[10px] text-text-subtle">
            Quoted: {Number(item.quotedQty || 0).toLocaleString("en-IN")} {unitLabel}
            {" | "}{formatAmount(item.quotedAmount || 0)}
            {" | "}Frozen measured: {Number(item.siteMeasuredQty || 0).toLocaleString("en-IN")} {unitLabel}
          </p>
        )}
      </td>
      <td className="px-2 py-2 align-top text-center">
        {showDims ? (
          <input
            type="text"
            value={computedQty.toFixed(2).replace(/\.00$/, "")}
            readOnly
            className={`${compactInput} text-center tabular-nums font-semibold cursor-default`}
          />
        ) : (
          <input
            type="number"
            value={item.qty}
            onChange={(e) => onUpdate({ qty: e.target.value })}
            onFocus={(e) => e.target.select()}
            disabled={disabled}
            className={`${compactInput} text-center tabular-nums disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
          />
        )}
      </td>
      <td className="px-2 py-2 align-top text-center">
        <span className="text-[11px] font-semibold text-text-muted">
          {unitLabel}
        </span>
      </td>
      <td className="px-2 py-2 align-top text-center">
        <span className="text-[12px] font-bold text-textcolor tabular-nums">
          {Number(item.rate || 0).toLocaleString("en-IN")}
        </span>
      </td>
      <td className="px-2 py-2 align-top text-center">
        <p className="text-[12px] font-bold text-textcolor tabular-nums">
          {formatAmount(r.net)}
        </p>
        {r.gst > 0 && (
          <p className="text-[9.5px] text-orange-500 tabular-nums">
            + {formatAmount(r.gst)}
          </p>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onToggleCompact}
            className="h-7 px-2 flex items-center justify-center rounded-md border border-bordergray text-[10px] font-semibold text-text-muted hover:text-select-blue hover:border-select-blue/30 bg-white"
            title="Show details"
          >
            Details
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={disabled}
            className="h-6 w-6 flex items-center justify-center rounded-md text-text-subtle hover:text-select-blue hover:bg-white"
            title="Edit in full form"
          >
            <Edit3 size={11} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="h-6 w-6 flex items-center justify-center rounded-md text-text-subtle hover:text-red-500 hover:bg-red-50"
            title="Remove row"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </td>
    </tr>
  );

  if (isCompact) {
    return (
      <>
        {compactMainRow}
        {showDims && (
          <DimensionEditor
            item={item}
            dimInfo={dimInfo}
            isArea={isArea}
            computedQty={computedQty}
            r={r}
            updateDim={updateDim}
            unitLabel={unitLabel}
            disabled={disabled}
          />
        )}
      </>
    );
  }

  return (
    <>
      <tr className="border-b border-bordergray hover:bg-bg-soft/40">
        <td className="px-2 py-2 align-top text-center">
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              className="text-text-subtle cursor-grab"
              title="Drag (coming soon)"
            >
              <GripVertical size={11} />
            </button>
            <span className="text-[10.5px] font-bold text-text-muted tabular-nums">
              {String(idx + 1).padStart(2, "0")}
            </span>
          </div>
        </td>
        <td className="px-2 py-2 align-top w-[42%] min-w-[260px] max-w-[520px]">
          <div className="space-y-1">
            <textarea
              value={item.description}
              onChange={(e) => onUpdate({ description: e.target.value })}
              disabled={disabled}
              placeholder="Item description"
              className={`${compactInput} font-medium resize-none disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
              rows={2}
            />
            {badges}
          </div>
          {!detailsOpen && summaryLine}
        </td>
        <td className="px-2 py-2 align-top text-center">
          {showDims ? (
            <input
              type="text"
              value={computedQty.toFixed(2).replace(/\.00$/, "")}
              readOnly
              className={`${compactInput} text-center tabular-nums font-semibold cursor-default`}
            />
          ) : (
            <input
              type="number"
              value={item.qty}
              onChange={(e) => onUpdate({ qty: e.target.value })}
              onFocus={(e) => e.target.select()}
              disabled={disabled}
              className={`${compactInput} text-center tabular-nums disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
            />
          )}
        </td>
        <td className="px-2 py-2 align-top text-center">
          <select
            value={item.unit}
            onChange={(e) => onUpdate({ unit: e.target.value })}
            disabled={disabled}
            className={`${compactInput} cursor-pointer disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
          >
            {UNITS.map((u) => (
              <option key={u.code} value={u.code}>
                {u.label}
              </option>
            ))}
          </select>
        </td>
        <td className="px-2 py-2 align-top text-center">
          <input
            type="number"
            value={item.rate}
            onChange={(e) => onUpdate({ rate: e.target.value })}
            onFocus={(e) => e.target.select()}
            disabled={disabled}
            className={`${compactInput} text-center tabular-nums disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
          />
        </td>
        <td className="px-2 py-2 align-top text-center">
          <p className="text-[12px] font-bold text-textcolor tabular-nums">
            {formatAmount(r.net)}
          </p>
          {r.gst > 0 && (
            <p className="text-[9.5px] text-orange-500 tabular-nums">
              + {formatAmount(r.gst)}
            </p>
          )}
        </td>
        <td className="px-2 py-2 align-top">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setDetailsOpen((p) => !p)}
              className={`h-7 px-2 flex items-center justify-center rounded-md border text-[10px] font-semibold transition-colors ${
                detailsOpen
                  ? "border-select-blue/30 bg-select-blue/10 text-select-blue"
                  : "border-bordergray bg-white text-text-muted hover:text-select-blue hover:border-select-blue/30"
              }`}
              title={detailsOpen ? "Hide details" : "Show HSN and materials"}
            >
              Details
            </button>
            <button
              type="button"
              onClick={onEdit}
              disabled={disabled}
              className="h-6 w-6 flex items-center justify-center rounded-md text-text-subtle hover:text-select-blue hover:bg-white"
              title="Edit in full form"
            >
              <Edit3 size={11} />
            </button>
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled}
              className="h-6 w-6 flex items-center justify-center rounded-md text-text-subtle hover:text-red-500 hover:bg-red-50"
              title="Remove row"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </td>
      </tr>

      {/* Dimension calculator row */}
      {showDims && (
        <DimensionEditor
          item={item}
          dimInfo={dimInfo}
          isArea={isArea}
          computedQty={computedQty}
          r={r}
          updateDim={updateDim}
          unitLabel={unitLabel}
          disabled={disabled}
        />
      )}

      {detailsOpen && (
        <ItemDetailsRow item={item} onUpdate={onUpdate} disabled={disabled} />
      )}
    </>
  );
};

const ItemDetailsRow = ({ item, onUpdate, disabled = false }) => {
  // Look up the Item Master entry so we can offer grade re-pricing.
  const libItem = useMemo(
    () =>
      item.masterId
        ? listLibrary().find((l) => l.id === item.masterId) || null
        : null,
    [item.masterId],
  );

  // Grades present in the Item Master recipe (economy / premium / luxury / custom).
  const libGrades = useMemo(() => {
    if (!libItem?.recipes) return [];
    const baseLabels = { economy: "Economy", premium: "Premium", luxury: "Luxury" };
    return Object.keys(libItem.recipes).map((k) => ({
      key: k,
      label:
        baseLabels[k] ||
        k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " "),
    }));
  }, [libItem]);

  // Pre-compute the derived rate for every available grade so we can show
  // price chips without re-running computeRecipe on every click.
  const libGradeRates = useMemo(() => {
    if (!libItem?.recipes) return {};
    const matLookup = mkMatById(listMaterials());
    const acc = {};
    for (const k of Object.keys(libItem.recipes)) {
      acc[k] = computeRecipe(libItem.recipes[k], matLookup).rate;
    }
    return acc;
  }, [libItem]);

  const currentGrade = item.grade || "economy";

  const applyGrade = (grade) => {
    if (!libItem?.recipes?.[grade]) return;
    const matLookup = mkMatById(listMaterials());
    const calc = computeRecipe(libItem.recipes[grade], matLookup);
    const newMaterials = recipeToMaterials(libItem.recipes[grade], matLookup);
    onUpdate({ grade, rate: Math.round(calc.rate), materials: newMaterials });
  };

  return (
    <tr className="border-b border-bordergray bg-bg-soft/30">
      <td colSpan={7} className="px-4 py-3">
        {/* Grade selector — only shown for library-linked items with multiple grades */}
        {libGrades.length > 1 && (
          <div className="mb-3 flex items-center gap-2 flex-wrap rounded-lg bg-active-bg/40 border border-select-blue/20 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-select-blue flex items-center gap-1 shrink-0">
              <Sparkles size={10} /> Grade
            </span>
            {libGrades.map(({ key, label }) => {
              const rate = libGradeRates[key];
              const isActive = currentGrade === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => !disabled && applyGrade(key)}
                  disabled={disabled}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10.5px] font-semibold transition-all disabled:cursor-not-allowed ${
                    isActive
                      ? "bg-select-blue text-white border-select-blue shadow-sm"
                      : "bg-white border-bordergray text-text-muted hover:border-select-blue/50 hover:text-select-blue"
                  }`}
                >
                  {label}
                  {rate > 0 && (
                    <span
                      className={`text-[9.5px] tabular-nums ${
                        isActive ? "text-white/80" : "text-text-subtle"
                      }`}
                    >
                      ₹{Math.round(rate).toLocaleString("en-IN")}
                    </span>
                  )}
                </button>
              );
            })}
            <span className="ml-auto text-[9.5px] text-text-subtle hidden sm:block">
              Sets rate + materials from Item Master recipe
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_130px] gap-3">
          <Field icon={<FileText size={11} />} label="Specification">
            <textarea
              value={item.spec || ""}
              onChange={(e) => onUpdate({ spec: e.target.value })}
              disabled={disabled}
              placeholder="Brand, model, finish, quality notes"
              className={`${compactInput} resize-none disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
              rows={2}
            />
          </Field>
          <Field icon={<Hash size={11} />} label="HSN">
            <input
              type="text"
              value={item.hsn || ""}
              onChange={(e) => onUpdate({ hsn: e.target.value })}
              disabled={disabled}
              placeholder="9403"
              list={`hsn-list-${item.id}`}
              className={`${compactInput} tabular-nums disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
            />
            <datalist id={`hsn-list-${item.id}`}>
              {HSN_SUGGESTIONS.map((h) => (
                <option key={h.code} value={h.code}>
                  {h.desc}
                </option>
              ))}
            </datalist>
          </Field>
        </div>
        <MaterialEditor item={item} onUpdate={onUpdate} disabled={disabled} />
      </td>
    </tr>
  );
};

// Mirrors the formula parser in procurementStorage so the editor's takeoff
// numbers always match what procurement computes. Format: "Q * <factor>".
const parseConsumeFormula = (formula) => {
  const text = String(formula || "").replace(/\s+/g, "");
  const m = text.match(/^(?:Q|Qty)\*([0-9]+(?:\.[0-9]+)?)$/i);
  return m ? Number(m[1]) : null;
};

const MaterialEditor = ({ item, onUpdate, disabled = false }) => {
  const [open, setOpen] = useState((item.materials || []).length > 0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [materialQuery, setMaterialQuery] = useState("");
  const materials = item.materials || [];
  const libraryMaterials = useMemo(() => listMaterials(), []);

  const update = (mats) => onUpdate({ materials: mats });

  const pickMaterial = (material) => {
    update([
      ...materials,
      {
        id: material.id || null,
        materialId: material.id || null,
        name: material.name || "",
        spec: material.specifications || material.spec || "",
        unit: material.unit || item.unit || "nos",
        qty: 1,
        wastagePct: 0,
        rate: Number(material.rate) || 0,
        consumptionMode: "per_unit",
        hsn: material.hsn || "",
        gstPercent: Number(material.gstPercent) || 0,
      },
    ]);
    setOpen(true);
    setPickerOpen(false);
    setMaterialQuery("");
  };
  const change = (idx, key, v) =>
    update(materials.map((m, i) => (i === idx ? { ...m, [key]: v } : m)));
  const patch = (idx, values) =>
    update(materials.map((m, i) => (i === idx ? { ...m, ...values } : m)));
  const remove = (idx) => update(materials.filter((_, i) => i !== idx));
  const itemQty = computeItemQty(item);

  // Prefer explicit qty/wastagePct fields (written by this editor and by
  // RateBuildupModal). Fall back to consumptionFormula which encodes
  // qty × (1 + waste%) as a single multiplier — same logic as procurementStorage.
  const materialCalc = (material) => {
    const hasExplicitQty =
      material.consumptionMode === "per_unit" ||
      material.qty != null ||
      material.perUnitQty != null ||
      material.consumptionQty != null;
    let perUnitQty, wastagePct;
    if (!hasExplicitQty) {
      const factor = parseConsumeFormula(material.consumptionFormula);
      perUnitQty = factor !== null ? factor : 1;
      wastagePct = 0;
    } else {
      const raw = Number(
        material.qty ?? material.perUnitQty ?? material.consumptionQty ?? 1,
      );
      perUnitQty = Number.isFinite(raw) && raw >= 0 ? raw : 1;
      wastagePct = Math.max(0, Number(material.wastagePct) || 0);
    }
    const takeoffQty = itemQty * perUnitQty * (1 + wastagePct / 100);
    const amount = takeoffQty * (Number(material.rate) || 0);
    return { perUnitQty, wastagePct, takeoffQty, amount };
  };

  // Sum of material costs per unit of work — shown as a read-only reference
  // so the user knows the material floor before adding labour and overhead.
  const derivedRate =
    itemQty > 0
      ? materials.reduce((sum, m) => sum + materialCalc(m).amount / itemQty, 0)
      : 0;
  const filteredMaterials = useMemo(() => {
    const query = materialQuery.trim().toLowerCase();
    if (!query) return libraryMaterials;
    return libraryMaterials.filter((material) =>
      [
        material.name,
        material.specifications,
        material.spec,
        material.unit,
        material.hsn,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [libraryMaterials, materialQuery]);

  return (
    <div className="mt-3 rounded-xl border border-bordergray bg-white px-3 py-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setOpen((p) => !p)}
            className="flex items-center gap-1.5 text-[10.5px] font-semibold text-text-muted hover:text-select-blue"
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Materials & Specifications
            {materials.length > 0 && (
              <span className="text-[9.5px] font-bold text-select-blue bg-white px-1.5 py-0.5 rounded border border-bordergray">
                {materials.length}
              </span>
            )}
            {!open && materials.length > 0 && (
              <span className="text-[10px] text-text-subtle truncate max-w-[400px] ml-1">
                {materials
                  .map((m) => `${m.name}${m.spec ? ` (${m.spec})` : ""}`)
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </button>
          {open && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  if (disabled) return;
                  setPickerOpen((prev) => !prev);
                  setMaterialQuery("");
                }}
                disabled={disabled}
                className="flex items-center gap-1 text-[10.5px] font-semibold text-select-blue hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Package size={11} /> Pick from Library
              </button>
              {pickerOpen && !disabled && (
                <div className="absolute right-0 z-30 mt-2 w-[360px] max-w-[calc(100vw-3rem)] rounded-xl border border-bordergray bg-white shadow-xl p-2">
                  <div className="flex items-center gap-1.5 border border-bordergray rounded-lg px-2 py-1.5">
                    <Search size={12} className="text-text-subtle shrink-0" />
                    <input
                      value={materialQuery}
                      onChange={(e) => setMaterialQuery(e.target.value)}
                      placeholder="Search material library..."
                      className="w-full text-[11.5px] text-textcolor outline-none placeholder:text-text-subtle"
                      autoFocus
                    />
                  </div>
                  <div className="mt-2 max-h-64 overflow-y-auto space-y-1">
                    {filteredMaterials.length === 0 ? (
                      <p className="px-2 py-3 text-[11px] text-text-subtle text-center">
                        No materials found in library.
                      </p>
                    ) : (
                      filteredMaterials.map((material, materialIdx) => (
                        <button
                          key={
                            material.id ||
                            `${material.name}-${material.specifications}-${materialIdx}`
                          }
                          type="button"
                          onClick={() => pickMaterial(material)}
                          className="w-full text-left rounded-lg px-2 py-2 hover:bg-bg-soft border border-transparent hover:border-bordergray"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[11.5px] font-semibold text-textcolor truncate">
                                {material.name || "Unnamed material"}
                              </p>
                              <p className="text-[10.5px] text-text-muted line-clamp-2">
                                {material.specifications || material.spec || "-"}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[11px] font-semibold text-select-blue tabular-nums">
                                {Number(material.rate) > 0
                                  ? formatAmount(material.rate)
                                  : "-"}
                              </p>
                              <p className="text-[10px] text-text-subtle">
                                {material.unit || "unit"}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {open && (
          <div className="mt-2 space-y-1.5 pl-5">
            {materials.length === 0 && (
              <p className="text-[10.5px] text-text-subtle">
                No materials specified. Pick from the Material Library to bring
                in the name, specification, unit, and rate.
              </p>
            )}
            {materials.length > 0 && (
              <div className="hidden md:grid grid-cols-[130px_1fr_70px_76px_70px_92px_28px] gap-2 mb-0.5 px-0.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">Material</span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">Specification</span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">Unit</span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">Qty / Unit</span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">Waste %</span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">Rate (₹)</span>
                <span />
              </div>
            )}
            {materials.map((m, idx) => {
              const unit = m.unit || item.unit || "nos";
              return (
                <div
                  key={idx}
                  className="grid grid-cols-1 md:grid-cols-[130px_1fr_70px_76px_70px_92px_28px] gap-2 items-start"
                >
                  <textarea
                    value={m.name}
                    onChange={(e) => change(idx, "name", e.target.value)}
                    disabled={disabled}
                    placeholder="Plywood"
                    className={`${compactInput} font-medium resize-none disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                    rows={1}
                  />
                  <textarea
                    value={m.spec}
                    onChange={(e) => change(idx, "spec", e.target.value)}
                    disabled={disabled}
                    placeholder="BWP 19mm Greenply"
                    className={`${compactInput} resize-none disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                    rows={1}
                  />
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => change(idx, "unit", e.target.value)}
                    disabled={disabled}
                    placeholder="Unit"
                    className={`${compactInput} disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                    title="Material unit"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={m.qty ?? m.perUnitQty ?? m.consumptionQty ?? 1}
                    onChange={(e) =>
                      patch(idx, {
                        qty: Number(e.target.value) || 0,
                        consumptionMode: "per_unit",
                      })
                    }
                    disabled={disabled}
                    placeholder="Qty/unit"
                    className={`${compactInput} text-right tabular-nums disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                    title="Material quantity consumed per BOQ unit"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={m.wastagePct ?? 0}
                    onChange={(e) =>
                      patch(idx, {
                        wastagePct: Number(e.target.value) || 0,
                        consumptionMode: "per_unit",
                      })
                    }
                    disabled={disabled}
                    placeholder="Waste %"
                    className={`${compactInput} text-right tabular-nums disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                    title="Wastage percentage"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={m.rate || 0}
                    onChange={(e) =>
                      change(idx, "rate", Number(e.target.value) || 0)
                    }
                    disabled={disabled}
                    placeholder="Rate"
                    className={`${compactInput} text-right tabular-nums disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
                  />
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    disabled={disabled}
                    className="h-7 w-7 flex items-center justify-center rounded-md text-text-subtle hover:text-red-500 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Remove material"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
            {materials.length > 0 && derivedRate > 0 && (
              <div className="mt-2 flex items-center gap-2 flex-wrap border-t border-bordergray/50 pt-2">
                <span className="text-[10px] text-text-muted">
                  Material cost:{" "}
                  <span className="font-bold text-textcolor tabular-nums">
                    {formatAmount(derivedRate)}
                  </span>
                  /unit
                </span>

                <span className="text-[9.5px] text-text-subtle">
                  excludes labour & overhead
                </span>
              </div>
            )}
          </div>
        )}
    </div>
  );
};

const ClientPicker = ({ current, onPick, onClear, disabled = false }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const handleOpen = () => {
    if (disabled) return;
    setOpen(true);
    setQuery("");
  };

  // Read clients lazily when the dropdown is open. Reading inside useMemo keeps
  // it reactive to query changes without needing a separate state setter.
  const filtered = useMemo(() => {
    if (!open) return [];
    const all = getAllClients();
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) =>
        (c.clientName || "").toLowerCase().includes(q) ||
        (c.clientID || "").toLowerCase().includes(q) ||
        (c.clientEmail || "").toLowerCase().includes(q),
    );
  }, [open, query]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={open ? () => setOpen(false) : handleOpen}
        disabled={disabled}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-bordergray bg-white text-[11px] font-semibold text-text-muted hover:bg-bg-soft hover:text-textcolor disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {current?.id ? "Change Client" : "Select Existing Client"}
      </button>
      {current?.id && (
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="ml-1 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-bordergray bg-white text-[11px] text-text-subtle hover:text-red-500 hover:border-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Unlink client"
        >
          <X size={11} />
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-[340px] bg-white rounded-xl border border-bordergray shadow-2xl z-50 overflow-hidden">
            <div className="p-2 border-b border-bordergray">
              <div className="relative">
                <Search
                  size={12}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, ID, or email"
                  className="w-full bg-bg-soft border border-transparent rounded-lg pl-7 pr-2 py-1.5 text-[11.5px] placeholder:text-text-subtle focus:outline-none focus:bg-white focus:border-select-blue/30"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-[11px] text-text-subtle text-center py-6">
                  No clients found
                </p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.clientID}
                    type="button"
                    onClick={() => {
                      onPick(c);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="w-full text-left px-3 py-2.5 border-b border-bordergray/60 hover:bg-active-bg/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-bold text-textcolor truncate">
                        {c.clientName}
                      </p>
                      <span className="text-[9.5px] font-semibold text-select-blue bg-select-blue/10 px-1.5 py-0.5 rounded border border-select-blue/20 shrink-0">
                        {c.clientID}
                      </span>
                    </div>
                    <p className="text-[10.5px] text-text-muted mt-0.5 truncate">
                      {c.clientEmail || c.clientPhone || "—"}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {c.location && (
                        <span className="text-[9.5px] font-semibold text-text-muted bg-bg-soft px-1.5 py-0.5 rounded">
                          {c.location}
                        </span>
                      )}
                      {c.locationSecondary && (
                        <span className="text-[9.5px] text-text-subtle truncate">
                          {c.locationSecondary}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
            <div className="p-2 border-t border-bordergray bg-bg-soft/40">
              <p className="text-[10px] text-text-subtle">
                Picking a client auto-fills name, contact, property type, and
                address into this BOQ.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const DimensionEditor = ({
  item,
  dimInfo,
  isArea,
  computedQty,
  r,
  updateDim,
  unitLabel,
  disabled = false,
}) => (
  <tr className="bg-active-bg/20 border-b border-bordergray">
    <td colSpan={7} className="px-3 py-3">
      <div className="flex items-start gap-3 flex-wrap">
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-select-blue mt-2">
          <Calculator size={11} /> Measurement
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          <DimInput
            label="Length (L)"
            suffix={dimInfo?.suffix}
            value={item.dimensions?.length || 0}
            onChange={(v) => updateDim({ length: v })}
            disabled={disabled}
          />
          {isArea && (
            <>
              <span className="text-text-subtle font-bold mt-2">×</span>
              <DimInput
                label="Depth (D)"
                suffix={dimInfo?.suffix}
                value={item.dimensions?.breadth ?? item.dimensions?.width ?? 0}
                onChange={(v) => updateDim({ breadth: v })}
                disabled={disabled}
              />
              <span className="text-text-subtle font-bold mt-2">×</span>
              <DimInput
                label="Height (H)"
                suffix={dimInfo?.suffix}
                value={item.dimensions?.height || 0}
                onChange={(v) => updateDim({ height: v })}
                disabled={disabled}
              />
            </>
          )}
          <span className="text-text-subtle font-bold mt-2">=</span>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">
              Total Qty
            </span>
            <span className="bg-white border border-select-blue/30 rounded-md px-3 py-1.5 text-right">
              <span className="text-[14px] font-bold text-select-blue tabular-nums leading-tight">
                {computedQty.toFixed(2).replace(/\.00$/, "")}{" "}
                <span className="text-[10px] text-text-muted font-normal">
                  {unitLabel}
                </span>
              </span>
            </span>
          </div>
        </div>
        <div className="ml-auto flex flex-col items-end gap-0.5 text-[10.5px] text-text-muted mt-1">
          <span>
            Rate{" "}
            <span className="font-bold tabular-nums text-textcolor">
              ₹{Number(item.rate || 0).toLocaleString("en-IN")}
            </span>{" "}
            / {unitLabel} · Line{" "}
            <span className="font-bold tabular-nums text-textcolor">
              {formatAmount(r.net)}
            </span>
          </span>
        </div>
      </div>
    </td>
  </tr>
);

const DimInput = ({ label, suffix, value, onChange, disabled = false }) => (
  <label className="flex flex-col gap-1">
    <span className="text-[9px] font-bold uppercase tracking-wider text-text-subtle">
      {label}
    </span>
    <span className="relative">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.target.select()}
        disabled={disabled}
        placeholder="0"
        title={label}
        className={`${compactInput} w-20 text-right tabular-nums ${suffix ? "pr-7" : "pr-2"} disabled:bg-bg-soft disabled:text-text-subtle disabled:cursor-not-allowed`}
      />
      {suffix && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9.5px] text-text-subtle font-semibold pointer-events-none">
          {suffix}
        </span>
      )}
    </span>
  </label>
);

// ─── Small components ──────────────────────────────────────────────────────
const formatSignoffDate = (iso) => {
  if (!iso) return "Pending";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const AuditTrailList = ({ items = [], revisionHistory = [], onViewSnapshot }) => {
  const latest = [...items].reverse();

  return (
    <div className="rounded-xl border border-bordergray bg-white">
      <div className="flex items-center justify-between border-b border-bordergray px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Approval History
        </span>
        <span className="rounded bg-bg-soft px-1.5 py-0.5 text-[9.5px] font-bold text-text-subtle">
          {items.length}
        </span>
      </div>
      {latest.length === 0 ? (
        <p className="px-3 py-3 text-[10.5px] text-text-subtle">
          No workflow events recorded yet.
        </p>
      ) : (
        <div className="max-h-52 overflow-y-auto">
          {latest.map((entry) => {
            const snap =
              entry.action === "revision_created"
                ? revisionHistory.find((r) => r.revision === entry.revision)
                : null;
            return (
              <div
                key={entry.id}
                className="border-b border-bordergray/70 px-3 py-2 last:border-b-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-textcolor">
                      {entry.label}
                    </p>
                    <p className="text-[10px] text-text-muted">
                      {entry.actor} · Rev {entry.revision} · {entry.status}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {snap && onViewSnapshot && (
                      <button
                        type="button"
                        onClick={() => onViewSnapshot(snap)}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold text-select-blue hover:bg-active-bg border border-select-blue/30"
                        title={`View Rev ${snap.revision} content`}
                      >
                        <Eye size={9} /> View Rev {snap.revision}
                      </button>
                    )}
                    <span className="text-[9.5px] font-semibold text-text-subtle">
                      {formatSignoffDate(entry.at)}
                    </span>
                  </div>
                </div>
                {entry.details && (
                  <p className="mt-1 text-[10px] leading-snug text-text-subtle">
                    {entry.details}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const RevisionSnapshotModal = ({ snapshot, onClose }) => {
  const totalItems = (snapshot.sections || []).reduce(
    (s, sec) => s + (sec.items?.length || 0),
    0,
  );
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-overallbg">
      {/* Header */}
      <div className="modal-no-print flex items-center justify-between gap-3 border-b border-bordergray bg-white px-4 py-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <History size={15} className="text-text-muted" />
          <span className="text-[13px] font-bold text-textcolor">
            Revision {snapshot.revision} Snapshot
          </span>
          <span className="rounded-full bg-bg-soft px-2 py-0.5 text-[10px] font-semibold text-text-muted border border-bordergray capitalize">
            {snapshot.status}
          </span>
          <span className="text-[10.5px] text-text-subtle">
            · {snapshot.sections?.length || 0} sections · {totalItems} items
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] text-text-subtle">
            {snapshot.at
              ? new Date(snapshot.at).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })
              : ""}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 rounded-lg border border-bordergray bg-white px-3 py-1.5 text-[11.5px] font-semibold text-textcolor hover:bg-bg-soft"
          >
            <X size={12} /> Close
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {(!snapshot.sections || snapshot.sections.length === 0) ? (
          <div className="text-center py-16 text-text-subtle text-[13px]">
            No sections were captured in this snapshot.
          </div>
        ) : (
          <div className="mx-auto max-w-4xl space-y-4">
            {snapshot.sections.map((sec, si) => (
              <div key={sec.id || si} className="rounded-xl border border-bordergray bg-white overflow-hidden">
                <div className="flex items-center gap-2 bg-bg-soft px-4 py-2.5 border-b border-bordergray">
                  <span className="text-[11px] font-bold text-textcolor">{sec.name || "Untitled Section"}</span>
                  {sec.category && (
                    <span className="text-[10px] text-text-muted">· {sec.category}</span>
                  )}
                  <span className="ml-auto text-[10px] text-text-subtle">{sec.items?.length || 0} items</span>
                </div>
                {(!sec.items || sec.items.length === 0) ? (
                  <p className="px-4 py-3 text-[11px] text-text-subtle">No items.</p>
                ) : (
                  <table className="w-full text-[11.5px]">
                    <thead>
                      <tr className="text-[10px] text-text-muted uppercase tracking-wide border-b border-bordergray">
                        <th className="px-4 py-2 text-center font-semibold w-8">#</th>
                        <th className="px-4 py-2 text-center font-semibold">Description</th>
                        <th className="px-4 py-2 text-center font-semibold">Qty</th>
                        <th className="px-4 py-2 text-center font-semibold">Unit</th>
                        <th className="px-4 py-2 text-center font-semibold">Rate</th>
                        <th className="px-4 py-2 text-center font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sec.items.map((item, ii) => {
                        const qty = computeItemQty(item);
                        const amt = qty * (Number(item.rate) || 0);
                        return (
                          <tr key={item.id || ii} className="border-b border-bordergray/60 last:border-b-0 hover:bg-bg-soft/40">
                            <td className="px-4 py-2 text-text-subtle">{ii + 1}</td>
                            <td className="px-4 py-2">
                              <p className="font-medium text-textcolor">{item.description || "—"}</p>
                              {item.spec && <p className="text-[10px] text-text-muted mt-0.5">{item.spec}</p>}
                            </td>
                            <td className="px-4 py-2 text-right text-textcolor">{Number(qty).toFixed(2)}</td>
                            <td className="px-4 py-2 text-text-muted">{item.unit || "—"}</td>
                            <td className="px-4 py-2 text-right text-textcolor">
                              {Number(item.rate || 0).toLocaleString("en-IN")}
                            </td>
                            <td className="px-4 py-2 text-right font-semibold text-textcolor">
                              {amt.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const SeedPicker = ({ onClose, onPick }) => {
  const [query, setQuery] = useState("");
  const keys = getPresetKeys();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return keys;
    return keys.filter((k) => k.toLowerCase().includes(q));
  }, [keys, query]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-bordergray flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-select-blue" />
            <h3 className="text-[13px] font-bold text-textcolor">
              Seed BOQ from Preset
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-4">
          <p className="text-[11.5px] text-text-muted mb-3">
            Choose a Proposal Master preset to auto-create sections and a
            starting line item per area. You can refine each line with detailed
            quantities and rates after.
          </p>
          <div className="relative mb-3">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search presets (e.g. 2BHK, Villa)"
              className="w-full bg-bg-soft border border-transparent rounded-lg pl-7 pr-3 py-1.5 text-[11.5px] placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-select-blue/30"
              autoFocus
            />
          </div>
          {filtered.length === 0 ? (
            <p className="text-[11px] text-gray-400 text-center py-6">
              No presets match "{query}"
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {filtered.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => onPick(k)}
                  className="text-left px-3 py-2.5 rounded-lg border border-bordergray hover:border-select-blue hover:bg-active-bg/30 transition-all"
                >
                  <p className="text-[12px] font-bold text-textcolor">{k}</p>
                  <p className="text-[10.5px] text-text-muted mt-0.5">
                    Load typical scope
                  </p>
                </button>
              ))}
            </div>
          )}
          <p className="text-[10.5px] text-gray-400 mt-3 flex items-center gap-1">
            <AlertTriangle size={10} /> Seeding replaces existing sections in
            this BOQ.
          </p>
        </div>
      </div>
    </div>
  );
};

const LibraryPicker = ({ onClose, onInsert }) => {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState({});

  const items = listLibrary();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (category !== "all" && it.category !== category) return false;
      if (!q) return true;
      return (
        (it.description || "").toLowerCase().includes(q) ||
        (it.hsn || "").toLowerCase().includes(q) ||
        (it.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [items, query, category]);

  const cats = useMemo(() => {
    const counts = items.reduce((acc, it) => {
      acc[it.category] = (acc[it.category] || 0) + 1;
      return acc;
    }, {});
    const rooms = getScheduleConfig().rooms.map((r) => r.name);
    return [
      { value: "all", label: "All", count: items.length },
      ...rooms.map((name) => ({
        value: name,
        label: name,
        count: counts[name] || 0,
      })),
    ].filter((c) => c.count > 0 || c.value === "all");
  }, [items]);

  const toggle = (id) => setSelected((p) => ({ ...p, [id]: !p[id] }));
  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const selectedItems = items.filter((it) => selected[it.id]);
  const handleInsert = () => {
    if (selectedItems.length === 0) return;
    onInsert(selectedItems);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[88vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-bordergray flex items-center justify-between bg-linear-to-r from-select-blue/5 to-white">
          <div className="flex items-center gap-2">
            <span className="h-8 w-8 rounded-lg bg-select-blue/10 text-select-blue flex items-center justify-center">
              <BookOpen size={14} />
            </span>
            <div>
              <h3 className="text-[14px] font-bold text-textcolor">
                Insert from Item Master
              </h3>
              <p className="text-[10.5px] text-text-muted">
                Pick one or more items — they'll be added to this section with
                materials, HSN, and rate filled in
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-bordergray flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {cats.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                className={`px-2.5 py-1 rounded-md text-[10.5px] font-semibold transition-all border ${
                  category === c.value
                    ? "bg-active-bg text-select-blue border-select-blue/30"
                    : "bg-transparent text-text-muted hover:bg-bg-soft border-transparent"
                }`}
              >
                {c.label} <span className="opacity-60">{c.count}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search description, HSN, tag"
              className="bg-bg-soft border border-transparent rounded-lg pl-7 pr-3 py-1.5 text-[11.5px] placeholder:text-text-subtle focus:outline-none focus:bg-white focus:border-select-blue/30 w-[240px]"
              autoFocus
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-3 space-y-1.5">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen size={28} className="text-text-subtle mx-auto mb-2" />
              <p className="text-[12px] font-semibold text-textcolor">
                No matches
              </p>
              <p className="text-[11px] text-text-muted mt-1">
                Try a different search or category.
              </p>
            </div>
          ) : (
            filtered.map((it) => {
              const c = roomColor(it.category);
              const isSelected = !!selected[it.id];
              const unitLabel =
                UNITS.find((u) => u.code === it.unit)?.label || it.unit;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => toggle(it.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                    isSelected
                      ? "border-select-blue bg-active-bg/40 shadow-[0_1px_3px_rgba(30,58,138,0.08)]"
                      : "border-bordergray hover:border-select-blue/30 hover:bg-bg-soft/40"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 h-5 w-5 flex items-center justify-center rounded-md border shrink-0 ${
                        isSelected
                          ? "bg-select-blue border-select-blue text-white"
                          : "bg-white border-bordergray"
                      }`}
                    >
                      {isSelected && <Check size={11} strokeWidth={3} />}
                    </span>
                    <span className={`h-2 w-2 rounded-full mt-2 ${c.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-semibold text-textcolor leading-snug">
                        {it.description}
                      </p>
                      {(it.materials || []).length > 0 && (
                        <p className="text-[10px] text-text-muted mt-0.5 truncate">
                          {it.materials
                            .map(
                              (m) => `${m.name}${m.spec ? ` (${m.spec})` : ""}`,
                            )
                            .join(" · ")}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-text-subtle">
                        {it.hsn && <span>HSN {it.hsn}</span>}
                        <span>GST {it.gstPercent}%</span>
                        {(it.usage || 0) > 0 && (
                          <span className="text-select-blue/70">
                            ↗ used {it.usage}×
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end shrink-0">
                      <span className="text-[13px] font-bold text-textcolor tabular-nums">
                        ₹{Number(it.rate || 0).toLocaleString("en-IN")}
                      </span>
                      <span className="text-[9.5px] text-text-subtle">
                        / {unitLabel}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="px-5 py-3 border-t border-bordergray bg-bg-soft flex items-center justify-between flex-wrap gap-2">
          <p className="text-[11px] text-text-muted">
            {selectedIds.length === 0
              ? "Select items to insert"
              : `${selectedIds.length} item${selectedIds.length === 1 ? "" : "s"} selected · total ₹${selectedItems
                  .reduce((s, it) => s + (Number(it.rate) || 0), 0)
                  .toLocaleString("en-IN")} (at qty 1)`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-bordergray bg-white text-[12px] font-semibold text-text-muted hover:text-textcolor"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleInsert}
              disabled={selectedIds.length === 0}
              className="px-4 py-1.5 rounded-lg bg-linear-to-br from-select-blue to-primary text-white text-[12px] font-semibold shadow-md hover:scale-[1.02] transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
            >
              <Plus size={12} /> Insert{" "}
              {selectedIds.length > 0 && `(${selectedIds.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const SectionTemplatePicker = ({ onClose, onAddBlank, onAddFromCategory }) => {
  const [selected, setSelected] = useState(null); // { value, label, icon, items }
  const [picked, setPicked] = useState({}); // { itemId: true } within selected category

  const items = listLibrary();

  const cats = getScheduleConfig().rooms.map((r) => {
    const matching = items.filter((it) => it.category === r.name);
    const total = matching.reduce((s, it) => s + (Number(it.rate) || 0), 0);
    return { value: r.name, label: r.name, items: matching, total };
  });

  // Drill into a category: pre-check every item so the default = full bundle.
  const enterCategory = (cat) => {
    const map = {};
    cat.items.forEach((it) => {
      map[it.id] = true;
    });
    setPicked(map);
    setSelected(cat);
  };

  const backToCategories = () => {
    setSelected(null);
    setPicked({});
  };

  const togglePick = (id) => setPicked((p) => ({ ...p, [id]: !p[id] }));

  const toggleAll = () => {
    if (!selected) return;
    const allOn = selected.items.every((it) => picked[it.id]);
    if (allOn) setPicked({});
    else {
      const m = {};
      selected.items.forEach((it) => (m[it.id] = true));
      setPicked(m);
    }
  };

  const pickedItems = selected
    ? selected.items.filter((it) => picked[it.id])
    : [];
  const pickedTotal = pickedItems.reduce(
    (s, it) => s + (Number(it.rate) || 0),
    0,
  );

  const handleConfirm = () => {
    if (!selected || pickedItems.length === 0) return;
    onAddFromCategory(selected.label, selected.value, pickedItems);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[88vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-bordergray flex items-center justify-between bg-linear-to-r from-select-blue/5 to-white">
          <div className="flex items-center gap-2">
            {selected ? (
              <button
                type="button"
                onClick={backToCategories}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-bordergray bg-white text-text-muted hover:text-textcolor hover:bg-bg-soft"
                title="Back to categories"
              >
                <ArrowLeft size={13} />
              </button>
            ) : (
              <span className="h-8 w-8 rounded-lg bg-select-blue/10 text-select-blue flex items-center justify-center">
                <Sparkles size={14} />
              </span>
            )}
            <div>
              <h3 className="text-[14px] font-bold text-textcolor">
                {selected
                  ? `${selected.label} — pick items`
                  : "Add Section from Library"}
              </h3>
              <p className="text-[10.5px] text-text-muted">
                {selected
                  ? `Uncheck any items you don't need for this client`
                  : "Pick a category to see its items — you can refine selection on the next step"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {!selected ? (
          // ── Category grid ─────────────────────────────────────────────
          <div className="overflow-y-auto flex-1 p-4">
            <div className="grid grid-cols-2 gap-2.5">
              {cats.map((cat) => {
                const c = roomColor(cat.value);
                const disabled = cat.items.length === 0;
                return (
                  <button
                    key={cat.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => enterCategory(cat)}
                    className={`text-left px-3 py-3 rounded-xl border transition-all ${
                      disabled
                        ? "border-bordergray bg-bg-soft/40 opacity-50 cursor-not-allowed"
                        : `${c.bg} ${c.border} hover:scale-[1.02] hover:shadow-md`
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-8 w-8 rounded-lg bg-white flex items-center justify-center shrink-0`}
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${c.dot}`}
                          />
                        </span>
                        <div className="min-w-0">
                          <p className={`text-[12.5px] font-bold ${c.text}`}>
                            {cat.label}
                          </p>
                          <p className="text-[10px] text-text-muted">
                            {cat.items.length === 0
                              ? "No items in library"
                              : `${cat.items.length} item${cat.items.length === 1 ? "" : "s"}`}
                          </p>
                        </div>
                      </div>
                      {cat.items.length > 0 && (
                        <span className="text-[10px] font-bold text-text-muted bg-white/70 px-1.5 py-0.5 rounded-md border border-bordergray shrink-0">
                          ₹{Math.round(cat.total).toLocaleString("en-IN")}
                        </span>
                      )}
                    </div>
                    {cat.items.length > 0 && (
                      <p className="text-[9.5px] text-text-muted mt-1.5 line-clamp-2">
                        {cat.items
                          .slice(0, 4)
                          .map((it) =>
                            it.description.split(" ").slice(0, 4).join(" "),
                          )
                          .join(" · ")}
                        {cat.items.length > 4 &&
                          ` +${cat.items.length - 4} more`}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="my-4 flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-subtle">
              <span className="flex-1 h-px bg-bordergray" />
              or build manually
              <span className="flex-1 h-px bg-bordergray" />
            </div>

            <button
              type="button"
              onClick={onAddBlank}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-dashed border-bordergray text-[12px] font-semibold text-text-muted hover:border-select-blue hover:text-select-blue hover:bg-active-bg/30 transition-all"
            >
              <Plus size={13} /> Add Blank Section
            </button>
          </div>
        ) : (
          // ── Item checklist for selected category ───────────────────────
          <div className="overflow-y-auto flex-1 flex flex-col">
            <div className="px-4 py-2.5 border-b border-bordergray bg-bg-soft/40 flex items-center justify-between">
              <button
                type="button"
                onClick={toggleAll}
                className="flex items-center gap-1.5 text-[11.5px] font-semibold text-select-blue hover:text-primary"
              >
                {selected.items.every((it) => picked[it.id]) ? (
                  <>
                    <X size={11} /> Deselect all
                  </>
                ) : (
                  <>
                    <Check size={11} /> Select all
                  </>
                )}
              </button>
              <span className="text-[10.5px] text-text-muted">
                <b className="text-textcolor">{pickedItems.length}</b> of{" "}
                {selected.items.length} selected
              </span>
            </div>

            <div className="p-3 space-y-1.5 flex-1">
              {selected.items.map((it) => {
                const c = roomColor(it.category);
                const isPicked = !!picked[it.id];
                const unitLabel =
                  UNITS.find((u) => u.code === it.unit)?.label || it.unit;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => togglePick(it.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                      isPicked
                        ? "border-select-blue bg-active-bg/40 shadow-[0_1px_3px_rgba(30,58,138,0.08)]"
                        : "border-bordergray bg-white hover:border-select-blue/30 hover:bg-bg-soft/40"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 h-5 w-5 flex items-center justify-center rounded-md border shrink-0 ${
                          isPicked
                            ? "bg-select-blue border-select-blue text-white"
                            : "bg-white border-bordergray"
                        }`}
                      >
                        {isPicked && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className={`h-2 w-2 rounded-full mt-2 ${c.dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-textcolor leading-snug">
                          {it.description}
                        </p>
                        {(it.materials || []).length > 0 && (
                          <p className="text-[10px] text-text-muted mt-0.5 truncate">
                            {it.materials
                              .map(
                                (m) =>
                                  `${m.name}${m.spec ? ` (${m.spec})` : ""}`,
                              )
                              .join(" · ")}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-text-subtle">
                          {it.hsn && <span>HSN {it.hsn}</span>}
                          <span>GST {it.gstPercent}%</span>
                          {(it.usage || 0) > 0 && (
                            <span className="text-select-blue/70">
                              ↗ used {it.usage}×
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end shrink-0">
                        <span className="text-[13px] font-bold text-textcolor tabular-nums">
                          ₹{Number(it.rate || 0).toLocaleString("en-IN")}
                        </span>
                        <span className="text-[9.5px] text-text-subtle">
                          / {unitLabel}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 border-t border-bordergray bg-bg-soft/50 flex items-center justify-between flex-wrap gap-2">
          {selected ? (
            <>
              <p className="text-[10.5px] text-text-muted">
                {pickedItems.length === 0
                  ? "Select at least one item"
                  : `Adds new "${selected.label}" section · est. ₹${Math.round(pickedTotal).toLocaleString("en-IN")} (at qty 1)`}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={backToCategories}
                  className="px-3 py-1.5 rounded-lg border border-bordergray bg-white text-[12px] font-semibold text-text-muted hover:text-textcolor"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={pickedItems.length === 0}
                  className="px-4 py-1.5 rounded-lg bg-linear-to-br from-select-blue to-primary text-white text-[12px] font-semibold shadow-md hover:scale-[1.02] transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed"
                >
                  <Plus size={12} /> Add{" "}
                  {pickedItems.length > 0 &&
                    `${pickedItems.length} item${pickedItems.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </>
          ) : (
            <p className="text-[10px] text-text-muted flex items-center gap-1">
              <Info size={10} /> Items are inserted as <b>linked</b> snapshots —
              collapsed by default, click <b>Override</b> on any row to change
              rate/HSN/GST for this BOQ.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const EmptySectionsState = ({ onAdd, onAddFromTemplate, onSeed }) => (
  <div className="bg-white rounded-2xl border border-dashed border-bordergray text-center py-12 px-6">
    <div className="h-14 w-14 rounded-2xl bg-linear-to-br from-select-blue/10 to-active-bg flex items-center justify-center mx-auto mb-3 border border-bordergray">
      <Layers size={20} className="text-select-blue" />
    </div>
    <p className="text-[14px] font-bold text-textcolor">Start your BOQ</p>
    <p className="text-[12px] text-text-muted mt-1 max-w-sm mx-auto">
      Pick a category to auto-create a section with all matching items from the
      Item Master, or seed a whole BOQ from a Proposal Master preset.
    </p>
    <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={onAddFromTemplate}
        className="flex items-center gap-1.5 px-3 py-2 bg-linear-to-br from-select-blue to-primary text-white rounded-lg text-[12px] font-semibold shadow-md shadow-select-blue/20 hover:shadow-lg"
      >
        <Sparkles size={13} /> Add Section from Library
      </button>
      <button
        type="button"
        onClick={onSeed}
        className="flex items-center gap-1.5 px-3 py-2 bg-white border border-bordergray rounded-lg text-[12px] font-semibold text-textcolor hover:bg-bg-soft"
      >
        <FileText size={13} /> Seed from Preset
      </button>
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-1.5 px-3 py-2 bg-white border border-bordergray rounded-lg text-[12px] font-semibold text-text-muted hover:bg-bg-soft"
      >
        <Plus size={13} /> Blank Section
      </button>
    </div>
  </div>
);

export default BOQEditor;
