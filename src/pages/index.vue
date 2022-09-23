<template>
	<div class="hero min-h-screen bg-base-200" v-if="synced">
		<div class="hero-content text-center">
			<div
				class="
					max-w-md
					flex
					justify-center
					flex-col
					items-center
					align-items-center
				"
			>
				<h1 class="text-5xl font-bold">Elymus</h1>
				<p class="py-6">
					It's time to stop total censorship that is tend to happen in nowadays
					internet. Elymus places data availability above all. Censoring Elymus
					sites is as complex as get rid of wildgrass in your garden: Even if
					single one seed of grass left, it will grow again. Same for Elymus:
					Even if one way to load website is available, site will work.
				</p>
				<a
					class="btn btn-primary"
					href="/setupSettings
                "
				>
					Get Started
				</a>
			</div>
		</div>
		<ConnectWallet />
	</div>
	<div v-else>{{ height }}</div>
</template>
<script setup>
const router = useRouter();

let height = ref(0);
let synced = ref(false);

setInterval(async () => {
	let hnsdStats = await $fetch("http://localhost:1111/api/hnsd-status");
	console.log(hnsdStats);
	height.value = hnsdStats.height;
	synced.value = hnsdStats.synced;
}, 1000);

if ((await elApi.kvGet("setuped")) && synced.value) {
	router.push({ path: "/home" });
}
</script>