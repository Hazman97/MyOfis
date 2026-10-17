<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Inbox } from "lucide-vue-next";
import ApprovalCard from "../components/ApprovalCard.vue";
import PageHeader from "../components/PageHeader.vue";
import { api, type Approval } from "../api/http.ts";
import { useOffice } from "../stores/office.ts";

const office = useOffice();
const items = ref<Approval[]>([]);
const showHistory = ref(false);

const load = async () => (items.value = (await api.approvals(showHistory.value ? "all" : "pending")).approvals);
onMounted(load);
// Live: refetch whenever the set of pending approvals changes.
watch(() => Object.keys(office.state.pending_approvals).join(","), load);
watch(showHistory, load);

const pending = computed(() => items.value.filter((a) => a.status === "pending"));
const decided = computed(() => items.value.filter((a) => a.status !== "pending"));
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <PageHeader
      sign="Notice board"
      title="Approvals"
      description="Agents stop here before anything risky. Approved commands run on the runner's machine with your user's permissions and no sandbox, so read them first."
    >
      <label class="inline-flex items-center gap-2 text-sm text-muted"><input v-model="showHistory" type="checkbox" class="accent-accent" /> Show history</label>
    </PageHeader>

    <div class="space-y-3">
      <ApprovalCard v-for="a in pending" :key="a.id" :approval="a" show-run-link @decided="load" />
      <div v-if="!pending.length" class="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-6 py-10 text-center">
        <Inbox :size="28" class="text-faint" :stroke-width="1.5" />
        <p class="font-medium">Nothing waiting for you</p>
        <p class="max-w-sm text-sm text-muted">When an agent wants to run something outside its allowlist, it waits here until you approve or reject it.</p>
      </div>
    </div>

    <template v-if="showHistory && decided.length">
      <h2 class="sign mt-8 mb-2">History</h2>
      <div class="space-y-2">
        <ApprovalCard v-for="a in decided" :key="a.id" :approval="a" show-run-link />
      </div>
    </template>
  </div>
</template>
